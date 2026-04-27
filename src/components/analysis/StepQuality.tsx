import { advanceStepAction } from "@/app/dashboard/analyze/[ticker]/actions";
import { ensureAnalysis } from "@/lib/positionFlow";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import type { Quote } from "@/lib/financial";
import MoatboardAnalysis from "@/components/MoatboardAnalysis";
import BusinessTypeHeader from "./BusinessTypeHeader";
import { SubmitButton, PendingOverlay } from "@/components/analysis/WizardPending";

export default async function StepQuality({
  ticker,
  quote,
  draftPositionId,
}: {
  ticker: string;
  quote: Quote | null;
  draftPositionId: number;
}) {
  const { fundamentals } = await fetchQuoteAndFundamentals(ticker);

  let analysis;
  let loadError: string | null = null;
  try {
    analysis = await ensureAnalysis(draftPositionId, ticker);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Failed to compute analysis";
    analysis = null;
  }

  // Early gate: if fewer than 5 applicable dimensions were scored the
  // framework doesn't fit this business. Offer to mark it outside the
  // analytical coverage rather than push to valuation.
  const applicable = analysis
    ? analysis.scorecard_summary.strong +
      analysis.scorecard_summary.acceptable +
      analysis.scorecard_summary.weak
    : 0;
  const unsupported = analysis !== null && applicable < 5;

  if (unsupported) {
    return (
      <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-xl font-bold text-navy-950">
          Moatboard can&apos;t analyze {ticker}
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-navy-700">
          The quality framework scored fewer than 5 applicable dimensions for
          this business. Common causes: recent IPO with thin fundamentals
          history, rare industry classification, or broken data. Rather than
          show a tier the framework can&apos;t back, Moatboard stops here.
        </p>
        <div className="mt-4 flex gap-3">
          <form action={advanceStepAction.bind(null, ticker, "decision", null)}>
            <button
              type="submit"
              className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800"
            >
              Decide (watchlist or discard) →
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <>
      {analysis && (
        <BusinessTypeHeader
          ticker={ticker}
          quote={quote}
          scorecardSummary={analysis.scorecard_summary}
        />
      )}

      <MoatboardAnalysis
        positionId={draftPositionId}
        ticker={ticker}
        analysis={analysis}
        fundamentals={fundamentals}
        loadError={loadError}
        hideRegenerate
      />

      <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm text-navy-700">
          Si la calidad cumple tu listón, continúa a entender el negocio.
          Si no, salta a la decisión y ponla en watchlist o descártala —
          así no gastas análisis en una empresa que ya has filtrado.
        </p>
        <div className="flex flex-wrap gap-3">
          <form
            action={advanceStepAction.bind(null, ticker, "understanding", null)}
          >
            <PendingOverlay message="Moatboard está leyendo el 10-K…" />
            <SubmitButton
              pendingLabel="Procesando…"
              className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
            >
              Continuar a entender el negocio →
            </SubmitButton>
          </form>
          <form action={advanceStepAction.bind(null, ticker, "decision", null)}>
            <button
              type="submit"
              className="rounded-lg border border-navy-300 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:border-navy-900"
            >
              Saltar a la decisión
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
