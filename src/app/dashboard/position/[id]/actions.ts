"use server";

import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { runAnalysis } from "@/lib/analysis";
import {
  generateThesis,
  structuredToProse,
  type ThesisContent,
} from "@/lib/thesis";
import {
  saveAnalysis,
  getAnalysisByPositionId,
} from "@/lib/moatboardAnalyses";
import {
  saveAiThesis,
  saveUserThesis,
  updateAiContent,
  deleteThesis,
} from "@/lib/theses";
import {
  computeDcfIntrinsicValue,
  classifyMarginOfSafety,
} from "@/lib/valuation";
import {
  suggestDcfAssumptions,
  estimateWithMultiples,
} from "@/lib/valuationAi";
import {
  getValuationByPositionId,
  saveValuation,
  type DcfStoredAssumptions,
} from "@/lib/valuations";
import { revalidatePath } from "next/cache";

async function assertPositionOwner(positionId: number) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }
  const position = await getPositionById(positionId, session.user.id);
  if (!position) {
    throw new Error("Position not found");
  }
  return position;
}

// ─── Moatboard Business Analysis ─────────────────────────────────────────

export async function runAnalysisAction(positionId: number) {
  const position = await assertPositionOwner(positionId);
  const result = await runAnalysis(position.ticker);
  await saveAnalysis({
    positionId,
    tier: result.tier,
    verdictReason: result.verdict_reason,
    scorecardSummary: result.scorecard_summary,
    moatStrength: result.moat_strength,
    moatArchetype: result.moat_archetype,
  });
  revalidatePath(`/dashboard/position/${positionId}`);
}

// ─── Thesis ──────────────────────────────────────────────────────────────

export async function generateAiThesisAction(positionId: number) {
  const position = await assertPositionOwner(positionId);

  let analysis = await getAnalysisByPositionId(positionId);

  if (!analysis) {
    // Auto-run analysis first if missing (one-click thesis flow)
    const result = await runAnalysis(position.ticker);
    analysis = await saveAnalysis({
      positionId,
      tier: result.tier,
      verdictReason: result.verdict_reason,
      scorecardSummary: result.scorecard_summary,
      moatStrength: result.moat_strength,
      moatArchetype: result.moat_archetype,
    });
  }

  if (analysis.tier === "poor") {
    revalidatePath(`/dashboard/position/${positionId}`);
    throw new Error(
      "Moatboard rates this business as Poor — AI thesis generation is not available. You can write your own thesis instead.",
    );
  }

  const { quote, fundamentals } = await fetchQuoteAndFundamentals(position.ticker);

  const content = await generateThesis(
    position.ticker,
    quote,
    fundamentals,
    analysis.tier,
    analysis.verdict_reason,
  );

  await saveAiThesis({
    positionId,
    rawText: structuredToProse(content),
    structuredContent: content,
  });

  revalidatePath(`/dashboard/position/${positionId}`);
}

export async function saveUserThesisAction({
  positionId,
  rawText,
}: {
  positionId: number;
  rawText: string;
}) {
  await assertPositionOwner(positionId);
  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    throw new Error("Thesis cannot be empty");
  }
  await saveUserThesis({ positionId, rawText: trimmed });
  revalidatePath(`/dashboard/position/${positionId}`);
}

export async function updateAiThesisAction({
  thesisId,
  positionId,
  content,
}: {
  thesisId: number;
  positionId: number;
  content: ThesisContent;
}) {
  await assertPositionOwner(positionId);
  for (const key of Object.keys(content) as (keyof ThesisContent)[]) {
    const f = content[key];
    if (
      !f ||
      typeof f.highlight !== "string" ||
      f.highlight.trim().length === 0 ||
      typeof f.body !== "string" ||
      f.body.trim().length === 0
    ) {
      throw new Error(`Field "${key}" cannot have empty highlight or body`);
    }
  }
  await updateAiContent({ thesisId, content });
  revalidatePath(`/dashboard/position/${positionId}`);
}

export async function deleteThesisAction(positionId: number) {
  await assertPositionOwner(positionId);
  await deleteThesis(positionId);
  revalidatePath(`/dashboard/position/${positionId}`);
}

// ─── Valuation ───────────────────────────────────────────────────────────

export async function runValuationAction(positionId: number) {
  const position = await assertPositionOwner(positionId);
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(position.ticker);

  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(
      "Cannot compute valuation — current market price is unavailable.",
    );
  }

  const currentPrice = quote.regularMarketPrice;
  const fcf = fundamentals?.freeCashflow ?? null;
  const sharesOutstanding = quote.sharesOutstanding;
  const useDcf =
    fcf !== null && fcf > 0 && sharesOutstanding !== null && sharesOutstanding > 0;

  if (useDcf) {
    const assumptions = await suggestDcfAssumptions(
      position.ticker,
      quote,
      fundamentals,
    );
    const netDebt =
      (fundamentals?.totalDebt ?? 0) - (fundamentals?.totalCash ?? 0);

    const breakdown = computeDcfIntrinsicValue({
      fcfBase: fcf!,
      growthRate: assumptions.growth_rate,
      terminalGrowth: assumptions.terminal_growth,
      discountRate: assumptions.discount_rate,
      netDebt,
      sharesOutstanding: sharesOutstanding!,
    });

    const { mosPct, tier } = classifyMarginOfSafety(
      breakdown.intrinsicValue,
      currentPrice,
    );

    const stored: DcfStoredAssumptions = {
      fcf_base: fcf!,
      growth_rate: assumptions.growth_rate,
      terminal_growth: assumptions.terminal_growth,
      discount_rate: assumptions.discount_rate,
      net_debt: netDebt,
      shares_outstanding: sharesOutstanding!,
    };

    await saveValuation({
      positionId,
      method: "dcf",
      intrinsicValue: breakdown.intrinsicValue,
      currentPrice,
      marginOfSafetyPct: mosPct,
      tier,
      assumptions: stored,
      reasoning: assumptions.reasoning,
    });
  } else {
    // Fallback: AI multiples-based estimate
    const reasonNotApplicable =
      fcf === null
        ? "FCF data not available"
        : fcf <= 0
          ? "FCF is negative"
          : "shares outstanding not available";

    const estimate = await estimateWithMultiples(
      position.ticker,
      quote,
      fundamentals,
    );

    const { mosPct, tier } = classifyMarginOfSafety(
      estimate.intrinsic_value,
      currentPrice,
    );

    await saveValuation({
      positionId,
      method: "ai_multiples",
      intrinsicValue: estimate.intrinsic_value,
      currentPrice,
      marginOfSafetyPct: mosPct,
      tier,
      assumptions: {
        basis: estimate.basis,
        sector_multiple_used: estimate.sector_multiple_used,
      },
      reasoning: `${estimate.reasoning} (DCF not applicable: ${reasonNotApplicable}.)`,
    });
  }

  revalidatePath(`/dashboard/position/${positionId}`);
}

export async function updateValuationAssumptionsAction({
  positionId,
  growthRate,
  terminalGrowth,
  discountRate,
}: {
  positionId: number;
  growthRate: number;
  terminalGrowth: number;
  discountRate: number;
}) {
  await assertPositionOwner(positionId);
  const valuation = await getValuationByPositionId(positionId);
  if (!valuation) {
    throw new Error("No valuation found for this position. Run valuation first.");
  }
  if (valuation.method !== "dcf") {
    throw new Error(
      "Editing assumptions only applies to DCF valuations. Use 'Regenerate with AI' for multiples-based valuations.",
    );
  }

  const stored = valuation.assumptions as DcfStoredAssumptions;
  const newAssumptions: DcfStoredAssumptions = {
    ...stored,
    growth_rate: growthRate,
    terminal_growth: terminalGrowth,
    discount_rate: discountRate,
  };

  const breakdown = computeDcfIntrinsicValue({
    fcfBase: stored.fcf_base,
    growthRate,
    terminalGrowth,
    discountRate,
    netDebt: stored.net_debt,
    sharesOutstanding: stored.shares_outstanding,
  });

  const currentPrice = Number(valuation.current_price);
  const { mosPct, tier } = classifyMarginOfSafety(
    breakdown.intrinsicValue,
    currentPrice,
  );

  await saveValuation({
    positionId,
    method: "dcf",
    intrinsicValue: breakdown.intrinsicValue,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier,
    assumptions: newAssumptions,
    reasoning: valuation.reasoning + " (Assumptions edited by user.)",
  });

  revalidatePath(`/dashboard/position/${positionId}`);
}
