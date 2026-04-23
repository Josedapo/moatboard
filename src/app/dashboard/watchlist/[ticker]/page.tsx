import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTickerState } from "@/lib/tickerStates";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { ensureDraftPosition } from "@/lib/positions";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import { getRedFlags } from "@/lib/redFlags";
import type {
  RelativeValuationSnapshot,
  Valuation,
} from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import PresentationsPanel from "@/components/position/PresentationsPanel";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import RedFlagsList from "@/components/shared/RedFlagsList";
import MoatboardAnalysisView from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import { reanalyzeTickerAction } from "../../actions";

// Dedicated per-ticker view for watchlist entries. Same informational
// surface as the Presentaciones tab on a live position (next earnings
// + SEC signal timeline) so the user can reason about a candidate
// before committing capital. Watchlist tickers don't have a position
// ficha — this is their equivalent.

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props) {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} · Watchlist` };
}

export default async function WatchlistTickerPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const state = await getTickerState({
    userId: session.user.id,
    ticker,
  });
  // Only watchlist entries render here. Redirect to history for
  // discarded/outside_circle, or 404 when the user has no record.
  if (!state || state.status !== "watchlist") notFound();

  // Get-or-create a draft position for this watchlisted ticker so the
  // existing ensureAnalysis / ensureValuation infrastructure can hang
  // its per-position artefacts off a real row. Drafts have no
  // transactions and stay hidden from the Dashboard. First visit
  // creates the draft + populates caches (moat, valuation_guide);
  // subsequent visits reuse them with zero AI calls.
  const draftPosition = await ensureDraftPosition(session.user.id, ticker);

  const [
    { quote, fundamentals },
    signals,
    understanding,
    redFlags,
  ] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    listSignalsForTicker({ userId: session.user.id, ticker }),
    getCurrentUnderstanding(ticker),
    getRedFlags(ticker),
  ]);

  // Scorecard + valuation: deterministic computations (+ cached AI on
  // moat and valuation guide, per-ticker 365d TTL). ensureAnalysis /
  // ensureValuation return early on DB hit, so re-visiting a watchlist
  // ticker is instant once the caches are warm.
  let analysis = null;
  let analysisError: string | null = null;
  try {
    analysis = await ensureAnalysis(draftPosition.id, ticker);
  } catch (err) {
    analysisError =
      err instanceof Error ? err.message : "Failed to load scorecard";
  }

  let valuation: Valuation | null = null;
  let valuationError: string | null = null;
  try {
    valuation = await ensureValuation(
      draftPosition.id,
      ticker,
      quote,
      fundamentals,
    );
  } catch (err) {
    valuationError =
      err instanceof Error ? err.message : "Failed to compute valuation";
  }

  let valuationGuide = null;
  if (valuation) {
    const snapshot = (
      valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
    ).relative_valuation;
    const ready = (s: RelativeValuationSnapshot["pe"] | undefined) =>
      !!s &&
      s.current !== null &&
      s.median !== null &&
      s.q1 !== null &&
      s.q3 !== null &&
      s.min !== null &&
      s.max !== null;
    valuationGuide = await ensureValuationGuide(ticker, quote, fundamentals, {
      pe: ready(snapshot?.pe),
      pfcf: ready(snapshot?.fcf_yield),
      pb: ready(snapshot?.pb),
    }).catch(() => null);
  }


  const nextEarningsDaysAway = quote?.nextEarningsDate
    ? daysUntil(quote.nextEarningsDate)
    : null;

  const nextReportType = quote?.nextEarningsDate
    ? await inferNextReportType({
        userId: session.user.id,
        ticker,
        nextEarningsDate: quote.nextEarningsDate,
      }).catch(() => null)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/dashboard/watchlist"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; Volver a watchlist
          </Link>
          <form action={reanalyzeTickerAction}>
            <input type="hidden" name="ticker" value={ticker} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 shadow-sm hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900"
            >
              Re-analizar &rarr;
            </button>
          </form>
        </div>

        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
              {ticker}
            </span>
            {quote?.longName && (
              <h1 className="text-2xl font-bold text-navy-950">
                {quote.longName}
              </h1>
            )}
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
              Watchlist
            </span>
          </div>
          {quote?.sector && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                {quote.sector}
              </span>
              {quote.industry && (
                <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                  {quote.industry}
                </span>
              )}
            </div>
          )}
          {state.review_when && (
            <div className="mt-4 text-sm text-navy-700">
              <span className="font-medium">Revisar cuando:</span>{" "}
              {state.review_when}
            </div>
          )}
          {state.reason_md && (
            <div className="mt-3 rounded-md border-l-2 border-navy-200 bg-navy-50/30 px-3 py-2 text-sm leading-relaxed text-navy-700">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                Por qué está en watchlist
              </div>
              <div className="whitespace-pre-line">{state.reason_md}</div>
            </div>
          )}
        </header>

        <PresentationsPanel
          positionId={null}
          signals={signals}
          nextEarningsDate={quote?.nextEarningsDate ?? null}
          nextEarningsDaysAway={nextEarningsDaysAway}
          nextReportType={nextReportType}
        />

        {/* Scorecard + moat + valuation — rendered off the draft
            position we ensure above. `hideRegenerate` keeps the
            watchlist view read-only; regenerating requires going
            through the wizard via "Re-analizar" above. */}
        {analysis && (
          <section className="mt-8">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-navy-500">
              Calidad del negocio
            </h2>
            <MoatboardAnalysisView
              positionId={draftPosition.id}
              ticker={ticker}
              analysis={analysis}
              fundamentals={fundamentals}
              loadError={analysisError}
              hideRegenerate
            />
          </section>
        )}

        {valuation && (
          <section className="mt-8">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-navy-500">
              Valoración
            </h2>
            <ValuationSection
              positionId={draftPosition.id}
              valuation={valuation}
              guide={valuationGuide}
              loadError={valuationError}
              hideRegenerate
            />
          </section>
        )}

        {/* Qualitative analysis — business understanding + red flags.
            The moat now renders as part of the Calidad section above,
            so it's no longer duplicated here. */}
        {(understanding || redFlags) && (
          <section className="mt-8">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-navy-500">
              Análisis cualitativo
            </h2>

            {understanding && (
              <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-navy-950">
                    Entiende el negocio
                  </h3>
                  <p className="mt-1 text-xs text-navy-500">
                    Versión {understanding.version} · generada el{" "}
                    {new Date(understanding.generated_at).toLocaleDateString(
                      "es-ES",
                      { year: "numeric", month: "long", day: "numeric" },
                    )}
                  </p>
                </div>
                <BusinessUnderstandingView understanding={understanding} />
              </section>
            )}

            {redFlags && (
              <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-navy-950">
                    Red flags cualitativas
                  </h3>
                  <p className="mt-1 text-xs text-navy-500">
                    Generadas el{" "}
                    {new Date(redFlags.generated_at).toLocaleDateString(
                      "es-ES",
                      { year: "numeric", month: "long", day: "numeric" },
                    )}
                  </p>
                </div>
                <RedFlagsList flags={redFlags.flags} />
              </section>
            )}
          </section>
        )}

        {!understanding && !redFlags && (
          <section className="mt-8 rounded-2xl border border-dashed border-navy-200 bg-navy-50/30 p-6 text-center">
            <p className="text-sm text-navy-600">
              Este ticker aún no tiene <em>Entender el negocio</em> ni{" "}
              <em>Red flags</em> cualitativas en caché. Pulsa{" "}
              <span className="font-medium text-navy-900">Re-analizar</span>{" "}
              arriba para generarlas.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

// Module-level helper — React 19 purity rule rejects Date.now() inside
// the server component render.
function daysUntil(value: string | Date): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
}
