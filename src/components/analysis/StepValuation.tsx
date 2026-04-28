import Link from "next/link";
import { exitAnalysisAction } from "@/app/dashboard/analyze/[ticker]/actions";
import { ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import ValuationSection from "@/components/Valuation";
import type {
  RelativeValuationSnapshot,
  Valuation,
} from "@/lib/valuations";

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
      />

      <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/30 p-6 shadow-sm">
        <h3 className="mb-2 text-base font-semibold text-navy-950">
          Has visto todo
        </h3>
        <p className="mb-5 text-sm text-navy-700">
          Quality, negocio, red flags y valoración en la mesa. La estrella
          de watchlist está siempre en la cabecera. Cuando quieras
          comprar, abre la pantalla dedicada y registra la operación con
          el compromiso de salida.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/dashboard/comprar/${ticker}`}
            className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Comprar acciones de {ticker} →
          </Link>
          <form action={exitAnalysisAction.bind(null, ticker)}>
            <button
              type="submit"
              className="rounded-lg border border-navy-300 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:border-navy-900"
            >
              Cerrar análisis
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
