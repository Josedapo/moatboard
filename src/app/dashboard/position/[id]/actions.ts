"use server";

import { auth } from "@/auth";
import {
  getPositionById,
  updatePositionPreCommitment,
} from "@/lib/positions";
import {
  fetchQuoteAndFundamentals,
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
} from "@/lib/valuation";
import {
  computeAndSaveValuation,
  deriveCompoundTier,
} from "@/lib/positionFlow";
import {
  getValuationByPositionId,
  saveValuation,
  type DcfStoredAssumptions,
} from "@/lib/valuations";
import {
  createTransaction,
  getCostBasis,
} from "@/lib/positionTransactions";
import { createTransactionalSnapshot } from "@/lib/snapshotFlow";
import { getTickerState, upsertTickerState } from "@/lib/tickerStates";
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
  const retentionMultiple =
    analysis.scorecard_summary.retentionMultiple ?? null;

  const content = await generateThesis(
    position.ticker,
    quote,
    fundamentals,
    management,
    tooHard,
    shareCountCagr,
    retentionMultiple,
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
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(
    position.ticker,
  );

  if (!quote || quote.regularMarketPrice == null) {
    throw new Error(
      "Cannot compute valuation — current market price is unavailable.",
    );
  }

  // Single source of truth: sector-aware dispatch lives in positionFlow.
  // Banks → Excess Returns, REITs → AFFO, rest → Owner Earnings DCF.
  await computeAndSaveValuation(
    positionId,
    position.ticker,
    quote,
    fundamentals,
  );

  revalidatePath(`/dashboard/position/${positionId}`);
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
  if (valuation.method !== "dcf" && valuation.method !== "affo_dcf") {
    throw new Error(
      "Editing growth only applies to DCF-based valuations (owner earnings / AFFO). Use 'Regenerate' for Excess Returns or AI multiples.",
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

  const range = computeIntrinsicValueRange({
    ownerEarningsBase: stored.owner_earnings_base,
    stageOneGrowth,
    terminalGrowth,
    netDebt: stored.net_debt,
    sharesOutstanding: stored.shares_outstanding,
  });

  const baseBreakdown = range.breakdowns.base;
  const baseEv = baseBreakdown.enterpriseValue;
  const pvBreakdown =
    baseEv > 0
      ? {
          stage_one_pct: baseBreakdown.pvOfStageOne / baseEv,
          stage_two_pct: baseBreakdown.pvOfStageTwo / baseEv,
          terminal_pct: baseBreakdown.pvOfTerminal / baseEv,
        }
      : undefined;

  const newAssumptions: DcfStoredAssumptions = {
    ...stored,
    stage_one_growth: stageOneGrowth,
    terminal_growth: terminalGrowth,
    pv_breakdown: pvBreakdown,
  };

  const currentPrice = Number(valuation.current_price);
  const { mosPct, tier: dcfTier } = classifyMarginOfSafety(
    range.base,
    currentPrice,
  );
  // Reuse the persisted relative snapshot — editing DCF assumptions doesn't
  // change the business's own multiple history. We only recompute the
  // compound tier because the DCF tier may have shifted.
  const relativeTier = valuation.relative_tier;
  const { compoundTier } = deriveCompoundTier(
    dcfTier,
    relativeTier !== null
      ? {
          relativeTier,
          snapshot: stored.relative_valuation ?? {
            years_of_data: 0,
            points_count: 0,
            pe: {
              current: null,
              median: null,
              q1: null,
              q3: null,
              min: null,
              max: null,
              current_percentile: null,
            },
            fcf_yield: {
              current: null,
              median: null,
              q1: null,
              q3: null,
              min: null,
              max: null,
              current_percentile: null,
            },
          },
        }
      : null,
  );

  await saveValuation({
    positionId,
    method: valuation.method, // preserve dcf vs affo_dcf
    intrinsicValue: range.base,
    intrinsicValueLow: range.low,
    intrinsicValueHigh: range.high,
    currentPrice,
    marginOfSafetyPct: mosPct,
    tier: compoundTier,
    dcfTier,
    relativeTier,
    assumptions: newAssumptions,
    reasoning: valuation.reasoning + " (Assumptions edited by user.)",
  });

  revalidatePath(`/dashboard/position/${positionId}`);
}

// ─── Position-level pre-commitment ───────────────────────────────────────

// Updates the "what would make me lose confidence in this investment" anchor.
// Empty / whitespace text clears it. Bumps pre_commitment_edited_at on every
// call so the UI can show "Editado el …".
export async function updatePositionPreCommitmentAction({
  positionId,
  text,
}: {
  positionId: number;
  text: string;
}): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  await assertPositionOwner(positionId);
  await updatePositionPreCommitment({
    positionId,
    userId: session.user.id,
    text,
  });
  revalidatePath(`/dashboard/position/${positionId}`);
}

// ─── Add operation (add / trim / sell on a live position) ────────────────

// Records a follow-up operation on an existing position. The first buy goes
// through the wizard's decideInvestAction; this is the path for everything
// after that. Snapshots fire on every operation (frozen frame of the quality
// + valuation picture at that moment). If a sell zeroes the position, the
// ticker_state flips to 'discarded' so the Closed position surfaces in
// /dashboard/history.
export async function addOperationAction(
  positionId: number,
  formData: FormData,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const userId = session.user.id;
  const position = await assertPositionOwner(positionId);

  const type = String(formData.get("type") ?? "");
  const transactionDate = String(formData.get("transaction_date") ?? "");
  const price = Number(formData.get("price"));
  const shares = Number(formData.get("shares"));
  const note = String(formData.get("note") ?? "").trim();

  // Trim was retired in favour of a single Sell that handles partial and
  // total exits — same shares-can't-go-negative guard, simpler vocabulary.
  // Legacy 'trim' rows in position_transactions remain valid; the column
  // CHECK still allows them so historical data renders correctly.
  if (type !== "add" && type !== "sell") {
    throw new Error("Invalid operation type");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    throw new Error("Invalid date");
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid price");
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error("Invalid number of shares");
  }

  if (type === "sell") {
    const basis = await getCostBasis(positionId);
    if (shares > basis.shares + 1e-9) {
      const fmt = (n: number) => n.toFixed(4).replace(/\.?0+$/, "");
      throw new Error(
        `Can't sell ${fmt(shares)} shares — you only own ${fmt(basis.shares)}.`,
      );
    }
  }

  const txn = await createTransaction({
    positionId,
    type,
    transactionDate,
    price,
    shares,
    preCommitmentMd: note.length > 0 ? note : null,
  });

  await createTransactionalSnapshot({
    userId,
    positionId,
    transactionId: txn.id,
  });

  // Reconcile ticker_state with post-op share count:
  //   · sell-to-zero on a live position → flip to 'discarded' so it leaves
  //     Portfolio and lands in /dashboard/history
  //   · add that brings shares from 0 (or any non-portfolio state) back to
  //     positive → flip to 'in_portfolio' so the position resurrects in
  //     Portfolio. Reason carries over the position-level commitment.
  // Position rows are never deleted; the trail is the value.
  const newBasis = await getCostBasis(positionId);
  const currentTickerState = await getTickerState({
    userId,
    ticker: position.ticker,
  });
  if (newBasis.shares <= 1e-9) {
    if (currentTickerState?.status !== "discarded") {
      await upsertTickerState({
        userId,
        ticker: position.ticker,
        status: "discarded",
        reasonMd: note.length > 0 ? note : "Position closed",
      });
    }
  } else if (
    currentTickerState &&
    currentTickerState.status !== "in_portfolio"
  ) {
    await upsertTickerState({
      userId,
      ticker: position.ticker,
      status: "in_portfolio",
      reasonMd: position.pre_commitment_md,
    });
  }

  revalidatePath(`/dashboard/position/${positionId}`);
  revalidatePath("/dashboard");
}
