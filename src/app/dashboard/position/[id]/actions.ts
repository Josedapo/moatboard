"use server";

import { auth } from "@/auth";
import {
  getPositionById,
  updatePositionPreCommitment,
  ensureDraftPosition,
} from "@/lib/positions";
import { ensureValuation } from "@/lib/positionFlow";
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
import { deriveCompoundTier } from "@/lib/positionFlow";
import {
  getValuationByPositionId,
  saveValuation,
  type DcfStoredAssumptions,
  type ImpliedReturnStoredAssumptions,
} from "@/lib/valuations";
import { computeImpliedReturn } from "@/lib/impliedReturn";
import {
  createTransaction,
  getCostBasis,
} from "@/lib/positionTransactions";
import { createTransactionalSnapshot } from "@/lib/snapshotFlow";
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

// ─── Implied Return — multiple change override ───────────────────────────
//
// User edit of the terminal multiple in the base and/or stress scenario.
// Inputs are in Nx form (the user's mental model: "I assume the
// multiple lands at 2.0x P/B"). null clears that scenario back to auto-
// derived. Both fields independent — passing only one preserves the
// other's existing state. Pure server-side recompute, no AI.
//
// Bootstrap path: when `positionId <= 0` (Discovery puro: ficha rendered
// with `computeImpliedReturnEphemeral`), the action requires `ticker`
// and lazily creates a draft position + persists a real valuation row
// before applying the override. After this, the user transitions to the
// non-ephemeral path on revalidate, and subsequent overrides hit the
// real positionId directly.

export async function updateImpliedReturnOverrideAction({
  positionId,
  ticker,
  baseTerminalMultiple,
  stressTerminalMultiple,
  baseGrowth,
  stressGrowth,
}: {
  positionId: number;
  // Required when positionId <= 0 (bootstrap path for Discovery puro).
  // Ignored otherwise — ownership is enforced via positionId.
  ticker?: string;
  baseTerminalMultiple?: number | null;
  stressTerminalMultiple?: number | null;
  // Growth overrides are signed decimals (0.12 = 12%/year). null = reset.
  baseGrowth?: number | null;
  stressGrowth?: number | null;
}) {
  // Bootstrap when there's no real position yet (Discovery puro). Creates
  // a draft + a real valuation row so the override has something to write
  // against. ensureDraftPosition is idempotent, so consecutive edits before
  // the first revalidate (race) reuse the same draft row.
  let effectivePositionId = positionId;
  if (positionId <= 0) {
    if (!ticker) {
      throw new Error("Ticker required to bootstrap a draft analysis.");
    }
    const session = await auth();
    if (!session?.user?.id) throw new Error("Not authenticated");
    const draft = await ensureDraftPosition(session.user.id, ticker);
    effectivePositionId = draft.id;
    const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);
    await ensureValuation(effectivePositionId, ticker, quote, fundamentals);
  } else {
    await assertPositionOwner(positionId);
  }
  const valuation = await getValuationByPositionId(effectivePositionId);
  if (!valuation) {
    throw new Error(
      "No valuation found for this position. Run valuation first.",
    );
  }
  if (valuation.method !== "implied_return") {
    throw new Error(
      "Override editable only applies to implied-return valuations.",
    );
  }

  const stored = valuation.assumptions as ImpliedReturnStoredAssumptions;
  const currentMultiple = stored.multiple_current ?? null;
  if (currentMultiple === null || currentMultiple <= 0) {
    throw new Error(
      "Cannot override: the current multiple is unavailable for this ticker.",
    );
  }

  // Validate inputs. Allow null (reset) or positive number ≤ 10× the
  // current multiple (sanity guard against fat-finger inputs like 200x).
  const validate = (
    v: number | null | undefined,
    label: string,
  ): number | null => {
    if (v === null || v === undefined) return null;
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`${label} must be a positive number or null to reset.`);
    }
    if (v > currentMultiple * 10) {
      throw new Error(
        `${label} (${v}x) is implausibly high vs current ${currentMultiple.toFixed(1)}x. Refusing to save.`,
      );
    }
    return v;
  };
  const baseTerm = validate(baseTerminalMultiple, "Base terminal multiple");
  const stressTerm = validate(
    stressTerminalMultiple,
    "Stress terminal multiple",
  );

  // Persist the absolute terminal Nx ("the multiple I believe this business
  // should converge to"), not a rate. The annualized rate is derived live
  // against the current multiple at render time, so when price moves the
  // anchor stays put. null → null (reset).
  // "only one passed" semantic — undefined keeps existing override; null clears.
  const newBaseTerminalOverride =
    baseTerminalMultiple === undefined
      ? (stored.multiple_base_terminal_override ?? null)
      : baseTerm;
  const newStressTerminalOverride =
    stressTerminalMultiple === undefined
      ? (stored.multiple_stress_terminal_override ?? null)
      : stressTerm;

  // Growth overrides — same undefined/null/value semantics as multiples.
  // Validate range: −10% to +30% per year (growth above 30% is implausible
  // for a 10-year horizon; below −10% is liquidation territory).
  const validateGrowth = (
    v: number | null | undefined,
    label: string,
  ): number | null => {
    if (v === null || v === undefined) return null;
    if (!Number.isFinite(v)) {
      throw new Error(`${label} must be a finite number or null to reset.`);
    }
    if (v < -0.1 || v > 0.3) {
      throw new Error(
        `${label} (${(v * 100).toFixed(1)}%) está fuera del rango razonable (−10% a 30%). Refusing to save.`,
      );
    }
    return v;
  };
  const baseGrowthValid = validateGrowth(baseGrowth, "Base growth override");
  const stressGrowthValid = validateGrowth(
    stressGrowth,
    "Stress growth override",
  );
  const newGrowthBaseOverride =
    baseGrowth === undefined
      ? (stored.growth_base_override ?? null)
      : baseGrowthValid;
  const newGrowthStressOverride =
    stressGrowth === undefined
      ? (stored.growth_stress_override ?? null)
      : stressGrowthValid;

  // Auto-derived values are persisted in the change fields when no
  // override existed. To recover them, derive from current/median/q1
  // exactly as positionFlow.ts does.
  const median = stored.multiple_median ?? null;
  const q1 = stored.multiple_q1 ?? null;
  const autoBaseChange =
    median !== null && median > 0 && currentMultiple > median
      ? Math.pow(median / currentMultiple, 1 / 10) - 1
      : 0;
  const autoStressChange =
    q1 !== null && q1 > 0 && q1 < currentMultiple
      ? Math.pow(q1 / currentMultiple, 1 / 10) - 1
      : 0;

  // Effective change: when an absolute terminal override is active, derive
  // the implied %/año against the current multiple at *this* moment. The
  // terminal stays anchored; the rate is just the math output, not the
  // user's expressed intent.
  const effectiveBaseChange =
    newBaseTerminalOverride !== null && newBaseTerminalOverride > 0
      ? Math.pow(newBaseTerminalOverride / currentMultiple, 1 / 10) - 1
      : autoBaseChange;
  const effectiveStressChange =
    newStressTerminalOverride !== null && newStressTerminalOverride > 0
      ? Math.pow(newStressTerminalOverride / currentMultiple, 1 / 10) - 1
      : autoStressChange;

  // Effective growth: override (if non-null) or the auto-derived value
  // already persisted in stored.growth.base/stress.
  const effectiveGrowthBase = newGrowthBaseOverride ?? stored.growth.base;
  const effectiveGrowthStress = newGrowthStressOverride ?? stored.growth.stress;

  // Effective terminal: override is the anchor; otherwise derive from change.
  const newBaseTerminal =
    newBaseTerminalOverride ??
    currentMultiple * Math.pow(1 + effectiveBaseChange, 10);
  const newStressTerminal =
    newStressTerminalOverride ??
    currentMultiple * Math.pow(1 + effectiveStressChange, 10);

  // Re-run the implied return formula with the new effective values.
  const impliedReturn = computeImpliedReturn({
    fcfYield: stored.fcf_yield,
    growthBase: effectiveGrowthBase,
    growthStress: effectiveGrowthStress,
    multipleChangeBase: effectiveBaseChange,
    multipleChangeStress: effectiveStressChange,
    treasuryYield: stored.treasury_yield,
  });

  const newAssumptions: ImpliedReturnStoredAssumptions = {
    ...stored,
    multiple_change_base: effectiveBaseChange,
    multiple_change_stress: effectiveStressChange,
    multiple_base_terminal_override: newBaseTerminalOverride,
    multiple_stress_terminal_override: newStressTerminalOverride,
    // Clear legacy rate-based overrides on any edit — once the absolute
    // model has written, the legacy fallback path is no longer needed for
    // this row.
    multiple_change_base_override: null,
    multiple_change_stress_override: null,
    multiple_base_terminal: newBaseTerminal,
    multiple_stress_terminal: newStressTerminal,
    growth_base_override: newGrowthBaseOverride,
    growth_stress_override: newGrowthStressOverride,
    base_cagr: impliedReturn.baseCAGR,
    stress_cagr: impliedReturn.stressCAGR,
    optimistic_cagr: impliedReturn.optimisticCAGR,
  };

  await saveValuation({
    positionId: effectivePositionId,
    method: "implied_return",
    intrinsicValue: Number(valuation.intrinsic_value ?? 0),
    intrinsicValueLow: Number(valuation.intrinsic_value_low ?? 0),
    intrinsicValueHigh: Number(valuation.intrinsic_value_high ?? 0),
    currentPrice: Number(valuation.current_price),
    marginOfSafetyPct: Number(valuation.margin_of_safety_pct ?? 0),
    tier: valuation.tier,
    dcfTier: valuation.dcf_tier,
    relativeTier: valuation.relative_tier,
    assumptions: newAssumptions,
    reasoning: `Override editado · base ${(impliedReturn.baseCAGR * 100).toFixed(1)}% / estrés ${(impliedReturn.stressCAGR * 100).toFixed(1)}%.`,
  });

  revalidatePath(`/dashboard/position/${effectivePositionId}`);
  revalidatePath(`/dashboard/position/${effectivePositionId}/trajectory`);
  if (ticker) {
    revalidatePath(`/dashboard/ticker/${ticker.toUpperCase()}`);
  }
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
// through /dashboard/comprar/[ticker]; this is the path for adds and sells
// on a live position. Snapshots fire on every operation (frozen frame of
// the quality + valuation picture at that moment). Sell-to-zero leaves
// the position with net=0 so the dashboard query hides it automatically;
// no state flip needed (post-2026-04-28 watchlist refactor).
export async function addOperationAction(
  positionId: number,
  formData: FormData,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const userId = session.user.id;
  await assertPositionOwner(positionId);

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

  // Post-2026-04-28: cartera derives from positions with net>0. Sell-to-zero
  // doesn't need a state flip — the dashboard query (EXISTS transactions WITH
  // net>0) hides the position automatically. Watchlist is independent of
  // ownership and stays untouched on transactions.

  revalidatePath(`/dashboard/position/${positionId}`);
  revalidatePath("/dashboard");
}
