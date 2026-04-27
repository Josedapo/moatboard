import Link from "next/link";
import { auth } from "@/auth";
import { listTickerStatesEnriched } from "@/lib/tickerStates";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import DashboardNav from "@/components/DashboardNav";
import {
  BusinessTierChip,
  FlagsBadge,
} from "@/components/shared/BusinessSignalChips";
import { reanalyzeTickerAction } from "../actions";

export const metadata = {
  title: "Watchlist",
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const items = await listTickerStatesEnriched({
    userId: session.user.id,
    status: "watchlist",
  });

  // Same pattern as the Dashboard's watchlistQuotes block: fetch Yahoo
  // quotes in parallel solely to surface a friendly company name. Cheap
  // at watchlist scale (typically <15 tickers); not worth caching.
  const companyNames = new Map<string, string | null>(
    await Promise.all(
      items.map(async (item) => {
        const { quote } = await fetchQuoteAndFundamentals(item.ticker);
        return [
          item.ticker,
          quote?.longName ?? quote?.shortName ?? null,
        ] as [string, string | null];
      }),
    ),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-navy-950">Watchlist</h1>
          <p className="mt-2 text-navy-600">
            {items.length === 0
              ? "Nothing on your watchlist yet. Tickers you decide to watch from the analysis wizard land here."
              : `${items.length} ${items.length === 1 ? "ticker" : "tickers"} you've decided to watch.`}
          </p>
        </header>

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-navy-200 bg-white hover:border-navy-400"
              >
                <div className="flex items-start justify-between gap-4 p-5">
                  <Link
                    href={`/dashboard/watchlist/${item.ticker}`}
                    className="flex-1"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-lg font-semibold text-navy-900">
                          {item.ticker}
                        </span>
                        {companyNames.get(item.ticker) && (
                          <span className="text-sm text-navy-700">
                            {companyNames.get(item.ticker)}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-navy-500">
                        added {formatDate(item.last_touched_at)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <BusinessTierChip tier={item.business_tier} />
                      <FlagsBadge
                        analyzed={item.business_tier !== null}
                        serious={item.serious_flag_count}
                        watch={item.watch_flag_count}
                        withLabels
                      />
                    </div>
                    {item.reason_md && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-navy-600">
                        {item.reason_md}
                      </p>
                    )}
                  </Link>
                  <form action={reanalyzeTickerAction}>
                    <input type="hidden" name="ticker" value={item.ticker} />
                    <button
                      type="submit"
                      className="rounded-lg border border-navy-300 px-3 py-1.5 text-sm text-navy-700 hover:border-navy-900 hover:text-navy-900"
                    >
                      Re-analyze
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-navy-700 hover:text-navy-900"
            >
              Go to your portfolio to start an analysis →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
