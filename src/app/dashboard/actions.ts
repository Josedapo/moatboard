"use server";

import { auth } from "@/auth";
import {
  createPosition,
  deletePosition,
  getDraftPositionByTicker,
  getPositionByTicker,
} from "@/lib/positions";
import { startSession } from "@/lib/analysisSessions";
import { validateTicker } from "@/lib/financial";
import {
  getTickerState,
  type TickerStatus,
} from "@/lib/tickerStates";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type PriorTickerState = {
  ticker: string;
  status: Exclude<TickerStatus, "in_portfolio">;
  reasonMd: string | null;
  reviewWhen: string | null;
  lastTouchedAt: string;
};

export type ActionState = {
  error?: string;
  success?: boolean;
  priorState?: PriorTickerState;
};

// Single entry point to the analysis wizard. Validates the ticker, ensures
// a draft position exists (creates one if not), ensures an active analysis
// session exists, and redirects into the wizard. Idempotent — calling it
// twice with the same ticker resumes the in-progress analysis rather than
// starting over.
export async function startAnalysisAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const ticker = String(formData.get("ticker") ?? "").trim();
  if (!ticker || !/^[A-Za-z.]{1,10}$/.test(ticker)) {
    return { error: "Invalid ticker format" };
  }

  const upper = ticker.toUpperCase();
  const confirmReanalysis = formData.get("confirmReanalysis") === "true";

  // If the user already owns this (has transactions), redirect to the live
  // position instead of starting a new analysis. Extensions on existing
  // positions use a shorter "add" flow handled from the position page (Phase 5).
  const live = await getPositionByTicker(session.user.id, upper);
  if (live) {
    // Distinguish live vs draft: only redirect to live page when there are
    // transactions. getPositionByTicker returns both — explicit check below.
    const draft = await getDraftPositionByTicker(session.user.id, upper);
    if (!draft) {
      // It's a live (transactional) position — send the user to its page.
      redirect(`/dashboard/position/${live.id}`);
    }
  }

  // Surface a reminder when the user already analyzed this ticker and reached
  // a non-portfolio terminal state. They can override with confirmReanalysis.
  if (!confirmReanalysis) {
    const prior = await getTickerState({ userId: session.user.id, ticker: upper });
    if (prior && prior.status !== "in_portfolio") {
      return {
        priorState: {
          ticker: prior.ticker,
          status: prior.status,
          reasonMd: prior.reason_md,
          reviewWhen: prior.review_when,
          lastTouchedAt: prior.last_touched_at,
        },
      };
    }
  }

  const isValid = await validateTicker(upper);
  if (!isValid) {
    return { error: `Ticker "${upper}" not found on Yahoo Finance` };
  }

  // Get or create the draft position.
  let draft = await getDraftPositionByTicker(session.user.id, upper);
  if (!draft) {
    draft = await createPosition({ userId: session.user.id, ticker: upper });
  }

  // Get or create the analysis session.
  await startSession({ userId: session.user.id, ticker: upper });

  redirect(`/dashboard/analyze/${upper}`);
}

// Re-enter the wizard for a ticker that already has a non-portfolio state
// (watchlist/discarded/outside_circle). Skips the reminder shown by the entry
// form because the caller (watchlist/history page) is already showing the
// prior decision in context.
export async function reanalyzeTickerAction(formData: FormData) {
  formData.append("confirmReanalysis", "true");
  await startAnalysisAction({}, formData);
}

export async function deletePositionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return;
  }

  const positionId = Number(formData.get("positionId"));
  if (!Number.isFinite(positionId)) {
    return;
  }

  await deletePosition(positionId, session.user.id);
  revalidatePath("/dashboard");
}
