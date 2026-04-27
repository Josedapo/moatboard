"use server";

import { auth } from "@/auth";
import {
  getActiveSession,
  advanceSession,
  completeSession,
  abandonActiveSession,
  stepIndex,
  type AnalysisStep,
  type UnderstoodFlag,
} from "@/lib/analysisSessions";
import { getTickerState, upsertTickerState } from "@/lib/tickerStates";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import {
  getDraftPositionByTicker,
  updatePositionPreCommitment,
} from "@/lib/positions";
import { createTransaction } from "@/lib/positionTransactions";
import { createTransactionalSnapshot } from "@/lib/snapshotFlow";
import {
  getCurrentUnderstanding,
  saveNewUnderstanding,
  appendFollowupQA,
} from "@/lib/businessUnderstanding";
import {
  generateBusinessUnderstanding,
  answerFollowupQuestion,
} from "@/lib/businessUnderstandingAi";
import { saveRedFlags } from "@/lib/redFlags";
import { generateRedFlags } from "@/lib/redFlagsAi";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import {
  prepareUnderstandingFiling,
  prepareRedFlagsFiling,
} from "@/lib/filingForPrompt";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireUserId(): Promise<string | number | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

// Generic step advance. Called from each step's "Continue" button. The
// understoodFlag and businessUnderstandingVersion are optional updates —
// the Understanding step sets understoodFlag, other steps pass null.
export async function advanceStepAction(
  ticker: string,
  nextStep: AnalysisStep,
  understoodFlag?: UnderstoodFlag | null,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const active = await getActiveSession({ userId, ticker });
  if (!active) {
    redirect(`/dashboard`);
  }

  // Grow furthest_step monotonically — only bump it when the new step is
  // deeper than what's already been reached. Backward navigation never
  // shrinks it (that's navigateToStepAction's job, which doesn't touch it).
  const newFurthest =
    stepIndex(nextStep) > stepIndex(active.furthest_step)
      ? nextStep
      : active.furthest_step;

  await advanceSession({
    sessionId: active.id,
    step: nextStep,
    understoodFlag: understoodFlag ?? null,
    furthestStep: newFurthest,
  });
  revalidatePath(`/dashboard/analyze/${ticker.toUpperCase()}`);
}

// Exit the wizard without completing. Session stays active so the user can
// resume later by re-entering the same ticker. The ticker is part of the
// signature because WizardShell binds it — we just don't need it here.
export async function exitAnalysisAction(ticker: string): Promise<void> {
  void ticker;
  redirect(`/dashboard`);
}

// Jump to a previously-completed step. Used by the step indicator in
// WizardShell. Intentionally doesn't touch understoodFlag or
// businessUnderstandingVersion — those were set when the user originally
// walked the step, and navigating back to review them shouldn't rewrite
// the record of that decision.
export async function navigateToStepAction(
  ticker: string,
  step: AnalysisStep,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const active = await getActiveSession({ userId, ticker });
  if (!active) redirect(`/dashboard`);

  await advanceSession({ sessionId: active.id, step });
  revalidatePath(`/dashboard/analyze/${ticker.toUpperCase()}`);
}

// -----------------------------------------------------------------------------
// Business understanding (Step 1) actions
// -----------------------------------------------------------------------------

// Forces a fresh generation — used by the "Regenerate" button. The previous
// version stays in business_understanding with archived_at set.
// Fetches the latest 10-K when available and passes it as primary source;
// silently falls back to pre-10K behaviour when SEC is unreachable.
export async function regenerateUnderstandingAction(
  ticker: string,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();

  const [{ quote, fundamentals }, filing] = await Promise.all([
    fetchQuoteAndFundamentals(upper),
    prepareUnderstandingFiling(upper),
  ]);
  const { generated, model } = await generateBusinessUnderstanding(
    upper,
    quote,
    fundamentals,
    filing,
  );
  await saveNewUnderstanding({
    ticker: upper,
    summaryMd: generated.summary_md,
    questionsAndAnswers: generated.questions_and_answers,
    sources: generated.sources,
    last10kAccession: filing?.accession ?? null,
    last10kPeriodEnd: filing?.reportDate ?? null,
    model,
  });
  revalidatePath(`/dashboard/analyze/${upper}`);
}

// Regenerate red flags for the ticker. Forces a fresh AI call and
// overwrites the cached row. Used by the "Regenerate" button in Step 2.
export async function regenerateRedFlagsAction(
  ticker: string,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();

  const [{ quote, fundamentals }, filing] = await Promise.all([
    fetchQuoteAndFundamentals(upper),
    prepareRedFlagsFiling(upper),
  ]);
  const { flags, model } = await generateRedFlags(
    upper,
    quote,
    fundamentals,
    filing,
  );
  await saveRedFlags({
    ticker: upper,
    flags,
    last10kAccession: filing?.accession ?? null,
    last10kPeriodEnd: filing?.reportDate ?? null,
    model,
  });
  revalidatePath(`/dashboard/analyze/${upper}`);
}

// Adds a free-form Q&A to the current version's history. The question is
// answered by the AI and appended to questions_and_answers (type: user_followup).
export async function askFollowupAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();

  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 3) return;

  const current = await getCurrentUnderstanding(upper);
  if (!current) return; // UI should never ask before generation

  const { answer } = await answerFollowupQuestion(upper, current, question);
  await appendFollowupQA({
    ticker: upper,
    version: current.version,
    qa: { question, answer },
  });
  revalidatePath(`/dashboard/analyze/${upper}`);
}

// -----------------------------------------------------------------------------
// Terminal actions (Decision step + Understanding's "I don't understand" exit)
// -----------------------------------------------------------------------------

export async function decideInvestAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const upper = ticker.toUpperCase();
  const active = await getActiveSession({ userId, ticker: upper });
  if (!active) redirect(`/dashboard`);

  const purchasePrice = Number(formData.get("purchase_price"));
  const purchaseDate = String(formData.get("purchase_date") ?? "");
  const shares = Number(formData.get("shares"));
  // Two distinct concepts captured here:
  //  · position_pre_commitment — position-level "what would make me lose
  //    confidence". Optional. Persisted to positions.pre_commitment_md.
  //  · operation_note — short "why this buy" attached to the transaction.
  //    Optional. Persisted to position_transactions.pre_commitment_md (column
  //    name kept for backwards compat; semantics are now per-operation).
  const positionPreCommitment = String(
    formData.get("position_pre_commitment") ?? "",
  ).trim();
  const operationNote = String(formData.get("operation_note") ?? "").trim();

  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    throw new Error("Invalid purchase price");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw new Error("Invalid purchase date");
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error("Invalid number of shares");
  }

  const draft = await getDraftPositionByTicker(userId, upper);
  if (!draft) {
    throw new Error(`No draft position found for ${upper}`);
  }

  // Persist the position-level commitment first (only if non-empty).
  if (positionPreCommitment.length > 0) {
    await updatePositionPreCommitment({
      positionId: draft.id,
      userId,
      text: positionPreCommitment,
    });
  }

  // Promote the draft: record the first buy, then snapshot the state.
  const txn = await createTransaction({
    positionId: draft.id,
    type: "buy",
    transactionDate: purchaseDate,
    price: purchasePrice,
    shares,
    preCommitmentMd: operationNote.length > 0 ? operationNote : null,
  });

  await createTransactionalSnapshot({
    userId,
    positionId: draft.id,
    transactionId: txn.id,
  });

  // Preserve the prior reason if this ticker had been parked (discarded /
  // watchlist / outside_circle) before — surfaced on the position page as
  // "you had X this on YYYY-MM-DD because Z before changing your mind".
  const prior = await getTickerState({ userId, ticker: upper });
  const priorReasonOnInvestMd =
    prior && prior.status !== "in_portfolio" && prior.reason_md
      ? prior.reason_md
      : null;

  // ticker_states.reason_md anchors the "why does this ticker have this
  // status" line surfaced on the History reminder. Prefer the position
  // commitment (the durable anchor); fall back to the per-op note.
  const reasonMd =
    positionPreCommitment.length > 0
      ? positionPreCommitment
      : operationNote.length > 0
        ? operationNote
        : null;

  // ticker_states is keyed under canonical (one entry per business);
  // positions stays under the actual purchased share class for cost
  // basis correctness.
  const canonical = await getCanonicalTicker(upper);
  await upsertTickerState({
    userId,
    ticker: canonical,
    status: "in_portfolio",
    reasonMd,
    priorReasonOnInvestMd,
  });

  await completeSession({ sessionId: active.id, outcome: "invested" });

  revalidatePath("/dashboard");
  redirect(`/dashboard/position/${draft.id}`);
}

export async function decideWatchlistAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const upper = ticker.toUpperCase();
  const active = await getActiveSession({ userId, ticker: upper });
  if (!active) redirect(`/dashboard`);

  const reason = String(formData.get("reason") ?? "").trim();

  const canonical = await getCanonicalTicker(upper);
  await upsertTickerState({
    userId,
    ticker: canonical,
    status: "watchlist",
    reasonMd: reason.length > 0 ? reason : null,
    reviewWhen: null,
  });

  // Keep the draft position alive. It's the anchor for the cached
  // moatboard_analyses / valuations / moat row — deleting it would
  // cascade those away and Discovery would lose the tier chip. Drafts
  // are already hidden from Dashboard (WHERE EXISTS transactions), so
  // leaving one behind has no user-visible cost.

  await completeSession({ sessionId: active.id, outcome: "watchlist" });

  revalidatePath("/dashboard");
  redirect(`/dashboard`);
}

export async function decideDiscardAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const upper = ticker.toUpperCase();
  const active = await getActiveSession({ userId, ticker: upper });
  if (!active) redirect(`/dashboard`);

  const reason = String(formData.get("reason") ?? "").trim();

  const canonicalDiscard = await getCanonicalTicker(upper);
  await upsertTickerState({
    userId,
    ticker: canonicalDiscard,
    status: "discarded",
    reasonMd: reason.length > 0 ? reason : null,
  });

  // Keep the draft for cached-analysis persistence (see watchlist path).
  // If the ticker resurfaces later, the verdict is still there.

  await completeSession({ sessionId: active.id, outcome: "discarded" });

  revalidatePath("/dashboard");
  redirect(`/dashboard`);
}

// Exit ramp from the Understanding step: user admits they don't understand
// the business. Not a failure — Buffett's circle-of-competence discipline.
export async function markOutsideCircleAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const upper = ticker.toUpperCase();
  const active = await getActiveSession({ userId, ticker: upper });
  if (!active) redirect(`/dashboard`);

  const reason = String(formData.get("reason") ?? "").trim();

  const canonicalOutside = await getCanonicalTicker(upper);
  await upsertTickerState({
    userId,
    ticker: canonicalOutside,
    status: "outside_circle",
    reasonMd: reason || null,
  });

  // Keep the draft so the partial Quality analysis stays cached. Marking
  // outside-circle doesn't mean "forget everything" — it just records
  // that the user shouldn't invest without first closing the gap.

  await completeSession({ sessionId: active.id, outcome: "outside_circle" });

  revalidatePath("/dashboard");
  redirect(`/dashboard`);
}

// Abandon the current session entirely. Draft position is kept so the user
// can still restart cleanly — startAnalysisAction will create a fresh session
// against the same draft.
export async function restartAnalysisAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  await abandonActiveSession({ userId, ticker: ticker.toUpperCase() });
  revalidatePath(`/dashboard/analyze/${ticker.toUpperCase()}`);
  redirect(`/dashboard`);
}
