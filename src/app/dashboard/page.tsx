import Link from "next/link";
import { auth } from "@/auth";
import { getPositionsByUserId } from "@/lib/positions";
import { getCostBasis } from "@/lib/positionTransactions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { listTickerStates } from "@/lib/tickerStates";
import { deletePositionAction } from "./actions";
import DashboardNav from "@/components/DashboardNav";
import AnalyzeEntryForm from "@/components/AnalyzeEntryForm";

export const metadata = {
  title: "Dashboard",
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    return null; // proxy will redirect
  }

  const [positions, watchlist, discarded, outsideCircle] = await Promise.all([
    getPositionsByUserId(session.user.id),
    listTickerStates({ userId: session.user.id, status: "watchlist" }),
    listTickerStates({ userId: session.user.id, status: "discarded" }),
    listTickerStates({ userId: session.user.id, status: "outside_circle" }),
  ]);
  const parkedCount = discarded.length + outsideCircle.length;

  // Fetch quote + cost basis per position in parallel. Cost basis is a DB
  // round-trip per position (listTransactions); at 5-15 positions it's
  // trivial. If it ever matters, batch it into one aggregate query.
  const enriched = await Promise.all(
    positions.map(async (p) => {
      const [quoteAndFundamentals, costBasis] = await Promise.all([
        fetchQuoteAndFundamentals(p.ticker),
        getCostBasis(p.id),
      ]);
      return {
        position: p,
        quote: quoteAndFundamentals.quote,
        costBasis,
      };
    }),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-navy-950">Your Portfolio</h1>
          <p className="mt-2 text-navy-600">
            {positions.length === 0
              ? "No positions yet. Add the first business you want to track."
              : `${positions.length} ${positions.length === 1 ? "position" : "positions"} tracked.`}
            {watchlist.length > 0 && (
              <>
                {" · "}
                <Link
                  href="/dashboard/watchlist"
                  className="underline decoration-navy-300 underline-offset-2 hover:text-navy-900 hover:decoration-navy-700"
                >
                  {watchlist.length} on watchlist
                </Link>
              </>
            )}
            {parkedCount > 0 && (
              <>
                {" · "}
                <Link
                  href="/dashboard/history"
                  className="underline decoration-navy-300 underline-offset-2 hover:text-navy-900 hover:decoration-navy-700"
                >
                  {parkedCount} parked
                </Link>
              </>
            )}
          </p>
        </header>

        <AnalyzeEntryForm />

        {enriched.length > 0 && (
          <div className="space-y-3">
            {enriched.map(({ position: p, quote, costBasis }) => {
              const avgCost = costBasis.avg_cost_per_share;
              const currentPrice = quote?.regularMarketPrice ?? null;
              const changePct =
                currentPrice !== null && avgCost !== null && avgCost > 0
                  ? ((currentPrice - avgCost) / avgCost) * 100
                  : null;
              const changeColor =
                changePct === null
                  ? "text-navy-500"
                  : changePct >= 0
                    ? "text-emerald-600"
                    : "text-red-600";

              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-navy-200 bg-white p-5 hover:border-navy-400"
                >
                  <Link
                    href={`/dashboard/position/${p.id}`}
                    className="flex-1"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-lg font-semibold text-navy-900">
                        {p.ticker}
                      </span>
                      {quote?.longName && (
                        <span className="text-sm text-navy-500">
                          {quote.longName}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-navy-500">
                      {avgCost !== null
                        ? `Avg cost $${avgCost.toFixed(2)} · ${formatShares(costBasis.shares)} shares`
                        : "No transactions yet"}
                    </div>
                  </Link>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-lg font-semibold text-navy-900">
                        {currentPrice !== null
                          ? `$${currentPrice.toFixed(2)}`
                          : "—"}
                      </div>
                      <div className={`text-sm ${changeColor}`}>
                        {changePct !== null
                          ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`
                          : "No data"}
                      </div>
                    </div>
                    <form action={deletePositionAction}>
                      <input type="hidden" name="positionId" value={p.id} />
                      <button
                        type="submit"
                        className="text-sm text-navy-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// Share counts can be fractional (most brokers support partial shares).
// Show up to 4 decimals but trim trailing zeros so whole numbers render clean.
function formatShares(shares: number): string {
  return shares
    .toFixed(4)
    .replace(/\.?0+$/, "");
}
