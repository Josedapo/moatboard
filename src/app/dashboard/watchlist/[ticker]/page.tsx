import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTickerState } from "@/lib/tickerStates";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import DashboardNav from "@/components/DashboardNav";
import PresentationsPanel from "@/components/position/PresentationsPanel";
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

  const [{ quote }, signals] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    listSignalsForTicker({ userId: session.user.id, ticker }),
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
