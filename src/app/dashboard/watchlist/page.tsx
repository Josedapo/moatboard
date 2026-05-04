import Link from "next/link";
import { auth } from "@/auth";
import { listWatchlistEnriched } from "@/lib/watchlistEntries";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { deriveLiveImpliedReturn } from "@/lib/impliedReturn";
import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import WatchlistStarToggle from "@/components/WatchlistStarToggle";
import {
  BusinessTierChip,
  ExpectedReturnChip,
  FlagsBadge,
} from "@/components/shared/BusinessSignalChips";

export const metadata = {
  title: "Watchlist",
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const items = await listWatchlistEnriched({
    userId: session.user.id,
  });

  // Fetch Yahoo quotes in parallel: friendly company name + today's
  // market cap (used to recompute the implied-return verdict against
  // live price so the chip reflects today, not the last regenerate).
  // Cheap at watchlist scale (typically <15 tickers); not worth caching.
  const liveQuotes = new Map<
    string,
    { name: string | null; marketCap: number | null }
  >(
    await Promise.all(
      items.map(async (item) => {
        const { quote } = await fetchQuoteAndFundamentals(item.ticker);
        return [
          item.ticker,
          {
            name: quote?.longName ?? quote?.shortName ?? null,
            marketCap: quote?.marketCap ?? null,
          },
        ] as [string, { name: string | null; marketCap: number | null }];
      }),
    ),
  );

  // Derive each ticker's live expected return by re-running the implied-
  // return formula against today's market cap. Pure function, no AI / DB
  // writes. Empty when no implied-return valuation exists for the ticker.
  const liveCAGRs = new Map<
    string,
    { base: number | null; stress: number | null }
  >();
  for (const item of items) {
    const stored = item.valuation_assumptions as
      | ImpliedReturnStoredAssumptions
      | null;
    const marketCap = liveQuotes.get(item.ticker)?.marketCap ?? null;
    if (stored && marketCap) {
      const live = deriveLiveImpliedReturn(stored, marketCap);
      liveCAGRs.set(item.ticker, {
        base: live.base_cagr,
        stress: live.stress_cagr,
      });
    } else if (stored) {
      liveCAGRs.set(item.ticker, {
        base: stored.base_cagr,
        stress: stored.stress_cagr,
      });
    } else {
      liveCAGRs.set(item.ticker, { base: null, stress: null });
    }
  }

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
                    href={`/dashboard/ticker/${item.ticker}`}
                    className="flex-1"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-lg font-semibold text-navy-900">
                          {item.ticker}
                        </span>
                        {liveQuotes.get(item.ticker)?.name && (
                          <span className="text-sm text-navy-700">
                            {liveQuotes.get(item.ticker)?.name}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-navy-500">
                        added {formatDate(item.last_touched_at)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <BusinessTierChip tier={item.business_tier} />
                      <ExpectedReturnChip
                        baseCAGR={liveCAGRs.get(item.ticker)?.base ?? null}
                        stressCAGR={liveCAGRs.get(item.ticker)?.stress ?? null}
                      />
                      <FlagsBadge
                        analyzed={item.business_tier !== null}
                        serious={item.serious_flag_count}
                        watch={item.watch_flag_count}
                        withLabels
                      />
                    </div>
                  </Link>
                  <WatchlistStarToggle
                    ticker={item.ticker}
                    isOnWatchlist={true}
                  />
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
