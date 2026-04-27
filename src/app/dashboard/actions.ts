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
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type PriorTickerState = {
  ticker: string;
  status: Exclude<TickerStatus, "in_portfolio">;
  reasonMd: string | null;
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

  const raw = String(formData.get("ticker") ?? "").trim();
  // Yahoo Finance uses hyphens for share-class separators (BRK-A, BRK-B).
  // Other providers use dots (BRK.A, typed by users out of habit) or
  // slashes (BRK/A, returned by OpenFIGI / Bloomberg). Normalize all three
  // to the Yahoo form before validating.
  const ticker = raw.replace(/[./]/g, "-");
  if (!ticker || !/^[A-Za-z-]{1,10}$/.test(ticker)) {
    return { error: "Invalid ticker format" };
  }

  const typed = ticker.toUpperCase();
  // Dual-class share consolidation: GOOG and GOOGL are the same business
  // (Alphabet), as are BRK-A and BRK-B (Berkshire). Resolve canonical
  // before doing anything else so the analysis cache, ticker_state and
  // wizard URL all share one identity per business. The canonical equals
  // the input when no alias is configured.
  const upper = await getCanonicalTicker(typed);
  const aliasNotice = upper !== typed ? typed : null;
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

  // Carry the alias notice as a query param so the wizard can render a
  // one-line italic Spanish notice on first load. Omitted when typed
  // ticker already equals canonical.
  const url = aliasNotice
    ? `/dashboard/analyze/${upper}?aliasNotice=${aliasNotice}`
    : `/dashboard/analyze/${upper}`;
  redirect(url);
}

// Re-enter the wizard for a ticker that already has a non-portfolio state
// (watchlist/discarded). Skips the reminder shown by the entry form because
// the caller (watchlist/history page) is already showing the prior decision
// in context.
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

// ---------------------------------------------------------------------------
// Review signals actions
// ---------------------------------------------------------------------------

// Mark a signal as reviewed. Optional note is free-text — today there's
// no enforced "artefact minimum" so `reviewed` is honour-based. If the
// inbox grows noisy we'll tighten it (e.g. floor signals require the
// trajectory moat validation, material signals require note ≥ 20 chars).
export async function markSignalReviewedAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;

  const signalId = Number(formData.get("signalId"));
  if (!Number.isFinite(signalId)) return;

  const note = ((formData.get("note") as string) ?? "").trim() || null;

  const { markSignalReviewed } = await import("@/lib/reviewSignals");
  await markSignalReviewed({ signalId, userId: session.user.id, note });
  revalidatePath("/dashboard");
}

// Mark several signals as reviewed in one go. Used by the inbox batch
// toolbar when the user has triaged a cluster of related filings (e.g.
// every 8-K from the same Q4 wave) and wants to clear them with one
// click instead of repeating the per-card flow. No note attached — if
// a single signal needs context, the user picks the per-card path.
export async function markSignalsReviewedBatchAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, count: 0 };

  const raw = formData.get("signalIds");
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false as const, count: 0 };
  }
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return { ok: false as const, count: 0 };

  const { markSignalReviewed } = await import("@/lib/reviewSignals");
  // Sequential to keep ownership checks (markSignalReviewed validates
  // the signal belongs to the user) deterministic and the error path
  // straightforward. At inbox scale (<50 signals) the cost is trivial.
  let count = 0;
  for (const id of ids) {
    try {
      await markSignalReviewed({ signalId: id, userId: session.user.id, note: null });
      count += 1;
    } catch (err) {
      console.error(`markSignalsReviewedBatch: failed for id=${id}:`, err);
    }
  }
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard");
  return { ok: true as const, count };
}

// Restore a signal back to `new`. Typical uses: user clicked "Marcar
// revisada" by mistake, or new context warrants revisiting a dismissed
// signal. Revalidates the inbox path so the tab counts refresh.
export async function reopenSignalAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;

  const signalId = Number(formData.get("signalId"));
  if (!Number.isFinite(signalId)) return;

  const { reopenSignal } = await import("@/lib/reviewSignals");
  await reopenSignal({ signalId, userId: session.user.id });
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard");
}

// Generate (or regenerate) the plain-language AI summary for a signal.
// Explicitly user-triggered so the LLM spend is always a deliberate
// decision. Result is cached on review_signals.summary_md and served
// from DB on subsequent visits until the user clicks "Regenerar".
//
// Returns an object the client can use to update its local state
// without a full page reload — cheaper feedback loop than revalidating
// the whole dashboard or inbox.
export async function summarizeSignalAction(formData: FormData): Promise<
  | { ok: true; summaryMd: string; summarizedAt: string; model: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autenticado" };
  }

  const signalId = Number(formData.get("signalId"));
  if (!Number.isFinite(signalId)) {
    return { ok: false, error: "signalId inválido" };
  }

  try {
    const { getSignalById, saveSignalSummary } = await import(
      "@/lib/reviewSignals"
    );
    const signal = await getSignalById({
      signalId,
      userId: session.user.id,
    });
    if (!signal) {
      return { ok: false, error: "Señal no encontrada" };
    }
    if (!signal.source_url) {
      return {
        ok: false,
        error: "Esta señal no tiene un documento asociado.",
      };
    }

    const { summariseFiling } = await import("@/lib/signalSummaryAi");
    const { summary_md, model } = await summariseFiling({
      ticker: signal.ticker,
      source: signal.source,
      eventType: signal.event_type,
      sourceUrl: signal.source_url,
    });

    await saveSignalSummary({
      signalId,
      userId: session.user.id,
      summaryMd: summary_md,
      model,
    });

    revalidatePath("/dashboard/inbox");
    return {
      ok: true,
      summaryMd: summary_md,
      summarizedAt: new Date().toISOString(),
      model,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: msg };
  }
}
