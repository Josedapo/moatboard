"use server";

import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import {
  fetchQuoteAndFundamentals,
  fetchMultiYearFundamentals,
  fetchTenYearTreasuryYieldAverage,
  fetchManagementSignals,
} from "@/lib/financial";
import { assessTooHard } from "@/lib/tooHard";
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
  classifyMarginOfSafety,
  computeIntrinsicValueRange,
  computeOwnerEarningsBase,
  observedGrowthRate,
  DEFAULT_HURDLE_RATES,
} from "@/lib/valuation";
import { estimateWithMultiples } from "@/lib/valuationAi";
import { buildDcfReasoning } from "@/lib/positionFlow";
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

  if (analysis.tier === "poor" || analysis.tier === "mediocre") {
    revalidatePath(`/dashboard/position/${positionId}`);
    const label = analysis.tier === "poor" ? "Poor" : "Mediocre";
    throw new Error(
      `Moatboard rates this business as ${label} — AI thesis generation is not available. You can write your own thesis instead.`,
    );
  }

  const [{ quote, fundamentals }, management] = await Promise.all([
    fetchQuoteAndFundamentals(position.ticker),
    fetchManagementSignals(position.ticker),
  ]);

  const tooHard = assessTooHard({
    sector: quote?.sector ?? null,
    industry: quote?.industry ?? null,
    moatStrength: analysis.moat_strength,
    moatArchetype: analysis.moat_archetype,
  });

  const shareCountCagr =
    analysis.scorecard_summary.multiYear?.shareCountTrend?.median ?? null;

  const content = await generateThesis(
    position.ticker,
    quote,
    fundamentals,
    management,
    tooHard,
    shareCountCagr,
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
  const [{ quote, fundamentals }, multiYear, treasury] = await Promise.all([
    fetchQuoteAndFundamentals(position.ticker),
    fetchMultiYearFundamentals(position.ticker),
    fetchTenYearTreasuryYieldAverage(),
  ]);

  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(
      "Cannot compute valuation — current market price is unavailable.",
    );
  }

  const currentPrice = quote.regularMarketPrice;
  const sharesOutstanding = quote.sharesOutstanding;

  if (sharesOutstanding === null || sharesOutstanding <= 0) {
    await saveMultiplesFallback(
      positionId,
      position.ticker,
      quote,
      fundamentals,
      currentPrice,
      "shares outstanding not available",
    );
    revalidatePath(`/dashboard/position/${positionId}`);
    return;
  }

  const trailingFcf = fundamentals?.freeCashflow ?? null;
  const ownerEarnings = computeOwnerEarningsBase(multiYear, trailingFcf);

  if (!ownerEarnings || ownerEarnings.value <= 0) {
    const reason =
      trailingFcf !== null && trailingFcf <= 0
        ? "owner earnings / FCF is negative"
        : "cash-flow base not available";
    await saveMultiplesFallback(
      positionId,
      position.ticker,
      quote,
      fundamentals,
      currentPrice,
      reason,
    );
    revalidatePath(`/dashboard/position/${positionId}`);
    return;
  }

  const stageOneGrowth = observedGrowthRate(multiYear);
  const terminalGrowth = treasury.fiveYearAveragePct;
  const netDebt =
    (fundamentals?.totalDebt ?? 0) - (fundamentals?.totalCash ?? 0);

  const range = computeIntrinsicValueRange({
    ownerEarningsBase: ownerEarnings.value,
    stageOneGrowth,
    terminalGrowth,
    netDebt,
    sharesOutstanding,
  });

  const { mosPct, tier } = classifyMarginOfSafety(range.base, currentPrice);

  const stored: DcfStoredAssumptions = {
    owner_earnings_base: ownerEarnings.value,
    net_income: ownerEarnings.netIncome,
    depreciation_amortization: ownerEarnings.depreciationAmortization,
    maintenance_capex_proxy: ownerEarnings.maintenanceCapexProxy,
    stage_one_growth: stageOneGrowth,
    terminal_growth: terminalGrowth,
    treasury_yield_pct: treasury.fiveYearAveragePct,
    treasury_source: treasury.source,
    hurdle_rates: {
      low: DEFAULT_HURDLE_RATES[2],
      base: DEFAULT_HURDLE_RATES[1],
      high: DEFAULT_HURDLE_RATES[0],
    },
    net_debt: netDebt,
    shares_outstanding: sharesOutstanding,
    years_of_history: ownerEarnings.yearsUsed,
    base_note: ownerEarnings.note,
  };

  await saveValuation({
    positionId,
    method: "dcf",
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier,
    assumptions: stored,
    reasoning: buildDcfReasoning(
      ownerEarnings.yearsUsed,
      stageOneGrowth,
      terminalGrowth,
      treasury.source,
    ),
  });

  revalidatePath(`/dashboard/position/${positionId}`);
}

async function saveMultiplesFallback(
  positionId: number,
  ticker: string,
  quote: NonNullable<Awaited<ReturnType<typeof fetchQuoteAndFundamentals>>["quote"]>,
  fundamentals: Awaited<ReturnType<typeof fetchQuoteAndFundamentals>>["fundamentals"],
  currentPrice: number,
  reasonNotApplicable: string,
) {
  const estimate = await estimateWithMultiples(ticker, quote, fundamentals);
  const { mosPct, tier } = classifyMarginOfSafety(
    estimate.intrinsic_value,
    currentPrice,
  );

  await saveValuation({
    positionId,
    method: "ai_multiples",
    intrinsicValue: estimate.intrinsic_value,
    intrinsicValueLow: estimate.intrinsic_value,
    intrinsicValueHigh: estimate.intrinsic_value,
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

// User can override the derived stage-one growth and terminal growth.
// Hurdle rates are fixed (10/12/14%) to preserve the philosophical frame:
// Buffett uses a fixed hurdle, not a CAPM-derived WACC per company.
export async function updateValuationAssumptionsAction({
  positionId,
  stageOneGrowth,
  terminalGrowth,
}: {
  positionId: number;
  stageOneGrowth: number;
  terminalGrowth: number;
}) {
  await assertPositionOwner(positionId);
  const valuation = await getValuationByPositionId(positionId);
  if (!valuation) {
    throw new Error("No valuation found for this position. Run valuation first.");
  }
  if (valuation.method !== "dcf") {
    throw new Error(
      "Editing assumptions only applies to DCF valuations. Use 'Regenerate' for multiples-based valuations.",
    );
  }
  if (!Number.isFinite(stageOneGrowth) || !Number.isFinite(terminalGrowth)) {
    throw new Error("Growth values must be numeric");
  }
  if (stageOneGrowth < 0 || stageOneGrowth > 0.3) {
    throw new Error("Stage-one growth must be between 0% and 30%");
  }
  if (terminalGrowth < 0 || terminalGrowth > 0.05) {
    throw new Error("Terminal growth must be between 0% and 5%");
  }

  const stored = valuation.assumptions as DcfStoredAssumptions;
  const newAssumptions: DcfStoredAssumptions = {
    ...stored,
    stage_one_growth: stageOneGrowth,
    terminal_growth: terminalGrowth,
  };

  const range = computeIntrinsicValueRange({
    ownerEarningsBase: stored.owner_earnings_base,
    stageOneGrowth,
    terminalGrowth,
    netDebt: stored.net_debt,
    sharesOutstanding: stored.shares_outstanding,
  });

  const currentPrice = Number(valuation.current_price);
  const { mosPct, tier } = classifyMarginOfSafety(range.base, currentPrice);

  await saveValuation({
    positionId,
    method: "dcf",
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier,
    assumptions: newAssumptions,
    reasoning: valuation.reasoning + " (Assumptions edited by user.)",
  });

  revalidatePath(`/dashboard/position/${positionId}`);
}
