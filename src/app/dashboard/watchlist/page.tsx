import Link from "next/link";
import { auth } from "@/auth";
import { listTickerStates } from "@/lib/tickerStates";
import DashboardNav from "@/components/DashboardNav";
import { reanalyzeTickerAction } from "../actions";

export const metadata = {
  title: "Watchlist",
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const items = await listTickerStates({
    userId: session.user.id,
    status: "watchlist",
  });

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
                className="rounded-xl border border-navy-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className="text-lg font-semibold text-navy-900">
                        {item.ticker}
                      </span>
                      <span className="text-xs text-navy-500">
                        added {formatDate(item.last_touched_at)}
                      </span>
                    </div>
                    {item.review_when && (
                      <div className="mt-1 text-sm text-navy-700">
                        <span className="font-medium">Review when:</span>{" "}
                        {item.review_when}
                      </div>
                    )}
                    {item.reason_md && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-navy-600">
                        {item.reason_md}
                      </p>
                    )}
                  </div>
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
