import { advanceStepAction } from "@/app/dashboard/analyze/[ticker]/actions";
import { ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import ValuationSection from "@/components/Valuation";
import type {
  RelativeValuationSnapshot,
  Valuation,
} from "@/lib/valuations";
import { SubmitButton, PendingOverlay } from "@/components/analysis/WizardPending";

export default async function StepValuation({
  ticker,
  draftPositionId,
}: {
  ticker: string;
  draftPositionId: number;
}) {
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);

  let valuation: Valuation | null = null;
  let loadError: string | null = null;
  try {
    valuation = await ensureValuation(
      draftPositionId,
      ticker,
      quote,
      fundamentals,
    );
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Failed to compute valuation";
  }

  // AI valuation guide — same availability check as the live position page.
  let guide = null;
  if (valuation) {
    const snapshot = (
      valuation.assumptions as {
        relative_valuation?: RelativeValuationSnapshot;
      }
    ).relative_valuation;
    const ready = (s: RelativeValuationSnapshot["pe"] | undefined) =>
      !!s &&
      s.current !== null &&
      s.median !== null &&
      s.q1 !== null &&
      s.q3 !== null &&
      s.min !== null &&
      s.max !== null;
    guide = await ensureValuationGuide(ticker, quote, fundamentals, {
      pe: ready(snapshot?.pe),
      pfcf: ready(snapshot?.fcf_yield),
      pb: ready(snapshot?.pb),
    });
  }

  return (
    <>
      <ValuationSection
        positionId={draftPositionId}
        ticker={ticker}
        valuation={valuation}
        guide={guide}
        loadError={loadError}
        hideRegenerate
      />

      <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm text-navy-700">
          With quality and valuation in front of you, decide: invest, put on
          the watchlist, or discard.
        </p>
        <form action={advanceStepAction.bind(null, ticker, "decision", null)}>
          <PendingOverlay message="Preparando el paso de decisión…" />
          <SubmitButton
            pendingLabel="Procesando…"
            className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
          >
            Continue to decision →
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
