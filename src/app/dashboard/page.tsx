import Link from "next/link";
import { auth } from "@/auth";
import { getPositionsByUserId } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { deletePositionAction } from "./actions";
import DashboardNav from "@/components/DashboardNav";
import AddPositionForm from "@/components/AddPositionForm";

export const metadata = {
  title: "Dashboard",
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    return null; // proxy will redirect
  }

  const positions = await getPositionsByUserId(session.user.id);
  const today = new Date().toISOString().slice(0, 10);

  // Fetch current quotes in parallel
  const quotes = await Promise.all(
    positions.map(async (p) => ({
      positionId: p.id,
      quote: (await fetchQuoteAndFundamentals(p.ticker)).quote,
    })),
  );
  const quoteMap = new Map(quotes.map((q) => [q.positionId, q.quote]));

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
          </p>
        </header>

        <AddPositionForm today={today} />

        {positions.length > 0 && (
          <div className="space-y-3">
            {positions.map((p) => {
              const quote = quoteMap.get(p.id);
              const purchasePrice = Number(p.purchase_price);
              const currentPrice = quote?.regularMarketPrice ?? null;
              const changePct =
                currentPrice !== null
                  ? ((currentPrice - purchasePrice) / purchasePrice) * 100
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
                      Bought at ${purchasePrice.toFixed(2)} on {p.purchase_date}
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
