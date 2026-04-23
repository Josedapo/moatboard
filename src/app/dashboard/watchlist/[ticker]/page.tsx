import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTickerState } from "@/lib/tickerStates";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import { getRedFlags } from "@/lib/redFlags";
import { getMoatAssessment } from "@/lib/moats";
import DashboardNav from "@/components/DashboardNav";
import PresentationsPanel from "@/components/position/PresentationsPanel";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import RedFlagsList from "@/components/shared/RedFlagsList";
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

  const [
    { quote },
    signals,
    understanding,
    redFlags,
    moat,
  ] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    listSignalsForTicker({ userId: session.user.id, ticker }),
    getCurrentUnderstanding(ticker),
    getRedFlags(ticker),
    getMoatAssessment(ticker),
  ]);

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

        {/* Qualitative analysis (read-only) — surfaces the ticker-level
            AI caches that survive beyond a specific position: business
            understanding, red flags, moat assessment. Scorecard and
            valuation are intentionally not rendered here because they
            are per-position (the draft position is deleted when a
            ticker lands on watchlist). Re-analyze button above recreates
            them on demand. */}
        {(understanding || redFlags || moat) && (
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

            {moat && (
              <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xl font-bold text-navy-950">
                    Moat
                  </h3>
                  <div className="flex gap-2 text-[10px] font-semibold uppercase tracking-wider">
                    <span
                      className={`rounded-full px-2.5 py-0.5 ring-1 ${
                        moat.strength === "strong"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : moat.strength === "weak"
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : "bg-navy-50 text-navy-700 ring-navy-200"
                      }`}
                    >
                      {moat.strength}
                    </span>
                    <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-navy-700 ring-1 ring-navy-200">
                      {moat.archetype.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-navy-700">
                  {moat.reasoning}
                </p>
              </section>
            )}
          </section>
        )}

        {!understanding && !redFlags && !moat && (
          <section className="mt-8 rounded-2xl border border-dashed border-navy-200 bg-navy-50/30 p-6 text-center">
            <p className="text-sm text-navy-600">
              Este ticker aún no tiene análisis cualitativo en caché. Pulsa{" "}
              <span className="font-medium text-navy-900">Re-analizar</span>{" "}
              arriba para generarlo.
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
