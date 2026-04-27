"use client";

import { useActionState } from "react";
import { startAnalysisAction, type ActionState } from "@/app/dashboard/actions";

const initialState: ActionState = {};

const STATUS_LABELS: Record<string, string> = {
  watchlist: "lo moviste a tu watchlist",
  discarded: "lo descartaste",
  outside_circle: "lo marcaste como fuera de tu círculo de competencia",
};

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

type Variant = "sidebar" | "inline";

// Editorial card · design-system.md §4.9 · analyze surface.
// Two variants so the form fits both the narrow Dashboard sidebar (stacked
// input + full-width button) and wide pages like Discovery (single-line
// input + auto-width right-aligned button).
export default function AnalyzeEntryForm({
  variant = "sidebar",
}: {
  variant?: Variant;
}) {
  const [state, formAction, pending] = useActionState(
    startAnalysisAction,
    initialState,
  );

  const prior = state.priorState;
  const isInline = variant === "inline";

  return (
    <div className="border border-ink bg-paper p-5">
      <p className="mb-3.5 font-display text-[13.5px] italic leading-[1.45] text-ink-70">
        Introduce un ticker para empezar el análisis guiado: entender el negocio, detectar red flags, revisar calidad y valoración, decidir.
      </p>

      {prior && (
        <div className="mb-4 border-l-2 border-amber bg-paper-sunk p-3 text-[13px] text-ink">
          <p>
            Ya analizaste{" "}
            <span className="font-display text-[14px]">{prior.ticker}</span>{" "}
            el {formatDate(prior.lastTouchedAt)} y{" "}
            {STATUS_LABELS[prior.status] ?? prior.status}.
          </p>
          {prior.reasonMd && (
            <p className="mt-2 whitespace-pre-wrap text-[12px] text-ink-70">
              <span className="uppercase tracking-[0.12em]">Razón:</span>{" "}
              {prior.reasonMd}
            </p>
          )}
          <form action={formAction} className="mt-3">
            <input type="hidden" name="ticker" value={prior.ticker} />
            <input type="hidden" name="confirmReanalysis" value="true" />
            <button
              type="submit"
              disabled={pending}
              className="bg-ink px-3.5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-paper disabled:opacity-50"
            >
              {pending
                ? "Iniciando..."
                : `Re-analizar ${prior.ticker} de todas formas`}
            </button>
          </form>
        </div>
      )}

      <form
        action={formAction}
        className={
          isInline
            ? "flex items-stretch gap-3"
            : "flex flex-col"
        }
      >
        <div
          className={
            isInline
              ? "flex-1 border-t border-ink pt-3"
              : "mb-3.5 border-t border-ink pt-3"
          }
        >
          <input
            id="ticker"
            name="ticker"
            type="text"
            required
            placeholder="AAPL"
            maxLength={10}
            autoComplete="off"
            className="w-full border-none bg-transparent p-0 font-display text-[22px] tracking-[0.05em] text-ink uppercase placeholder:normal-case placeholder:italic placeholder:text-ink-30 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className={
            isInline
              ? "self-end bg-ink px-6 py-2.5 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-paper disabled:opacity-50"
              : "w-full bg-ink px-3.5 py-2.5 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-paper disabled:opacity-50"
          }
        >
          {pending ? "Iniciando..." : "Empezar"}
        </button>
      </form>
      {state.error && (
        <p className="mt-3 text-[12.5px] text-red">{state.error}</p>
      )}
    </div>
  );
}
