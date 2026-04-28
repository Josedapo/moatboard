"use server";

import { auth } from "@/auth";
import {
  getActiveSession,
  advanceSession,
  deleteSession,
  stepIndex,
  type AnalysisStep,
  type UnderstoodFlag,
} from "@/lib/analysisSessions";
import { upsertPreAnalysisFromExisting } from "@/lib/preAnalysisFlow";
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

  // Lift the user's wizard outputs into the shared per-ticker cache
  // (`discovery_pre_analyses`) at every step boundary so Iris's scope
  // includes partially-analyzed tickers — the user benefits from auto-
  // refresh of whichever pieces have already been analyzed when a new
  // 10-K / 10-Q lands. Idempotent and free of IA calls — pure DB read +
  // upsert.
  try {
    await upsertPreAnalysisFromExisting(ticker.toUpperCase());
  } catch (err) {
    // Non-fatal: shared cache hiccups must not block the wizard.
    console.error(
      `upsertPreAnalysisFromExisting failed for ${ticker}: ${(err as Error).message}`,
    );
  }

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

// Wipe the session for (user, ticker) so the wizard restarts from
// step 1 on next entry. Cached pieces (Quality, Understanding, Red
// flags, Valuation) survive — they're per-ticker — so the rerun hits
// cache for free. Draft position is also untouched.
export async function restartAnalysisAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  await deleteSession({ userId, ticker: ticker.toUpperCase() });
  revalidatePath(`/dashboard/analyze/${ticker.toUpperCase()}`);
  redirect(`/dashboard`);
}
