"use server";

import { auth } from "@/auth";
import { deletePosition } from "@/lib/positions";
import { validateTicker } from "@/lib/financial";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionState = {
  error?: string;
  success?: boolean;
};

// Discovery / search entry point — validates the ticker and redirects
// to the unified ficha. The ficha is the canonical surface for any
// company; from there the user explicitly opts in to the wizard via
// "Empezar análisis" / "Re-analizar" on the Decisión tab.
export async function openTickerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const raw = String(formData.get("ticker") ?? "").trim();
  const ticker = raw.replace(/[./]/g, "-");
  if (!ticker || !/^[A-Za-z-]{1,10}$/.test(ticker)) {
    return { error: "Invalid ticker format" };
  }

  const upper = await getCanonicalTicker(ticker.toUpperCase());

  const isValid = await validateTicker(upper);
  if (!isValid) {
    return { error: `Ticker "${upper}" not found on Yahoo Finance` };
  }

  redirect(`/dashboard/ticker/${upper}`);
}

// Plain-FormData wrapper of openTickerAction — used by callers that
// don't want to thread useActionState (e.g. the Discovery leaderboard's
// empty-state CTA, which is a one-shot submit, not a stateful form).
export async function openTickerSubmitAction(formData: FormData) {
  await openTickerAction({}, formData);
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
