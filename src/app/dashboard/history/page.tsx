import Link from "next/link";
import { auth } from "@/auth";
import { listTickerStatesEnriched } from "@/lib/tickerStates";
import { listLivedPositionIdsByTicker } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import DashboardNav from "@/components/DashboardNav";
import HistoryFilters from "@/components/HistoryFilters";

export const metadata = {
  title: "History",
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const [discarded, outsideCircle, livedPositionsMap] = await Promise.all([
    listTickerStatesEnriched({
      userId: session.user.id,
      status: "discarded",
    }),
    listTickerStatesEnriched({
      userId: session.user.id,
      status: "outside_circle",
    }),
    listLivedPositionIdsByTicker(session.user.id),
  ]);

  const total = discarded.length + outsideCircle.length;

  // Yahoo quotes in parallel for the friendly company name. Cheap at
  // history scale; not worth caching. Map → plain object so it serializes
  // cleanly to the Client Component.
  const allTickers = [...discarded, ...outsideCircle].map((i) => i.ticker);
  const companyNames = Object.fromEntries(
    await Promise.all(
      allTickers.map(async (ticker) => {
        const { quote } = await fetchQuoteAndFundamentals(ticker);
        return [ticker, quote?.longName ?? quote?.shortName ?? null] as [
          string,
          string | null,
        ];
      }),
    ),
  );
  const livedPositions = Object.fromEntries(livedPositionsMap);

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-navy-950">History</h1>
          <p className="mt-2 text-navy-600">
            {total === 0
              ? "Nothing here yet. Tickers you discard or mark as outside your circle of competence will appear here."
              : `${total} ${total === 1 ? "ticker" : "tickers"} parked.`}
          </p>
        </header>

        {total === 0 ? (
          <div className="rounded-xl border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-navy-700 hover:text-navy-900"
            >
              Go to your portfolio to start an analysis →
            </Link>
          </div>
        ) : (
          <HistoryFilters
            discarded={discarded}
            outsideCircle={outsideCircle}
            companyNames={companyNames}
            livedPositions={livedPositions}
          />
        )}
      </main>
    </div>
  );
}
