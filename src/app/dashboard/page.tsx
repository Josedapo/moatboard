import { auth } from "@/auth";
import { getPositionsByUserId } from "@/lib/positions";
import { addPositionAction, deletePositionAction } from "./actions";
import DashboardNav from "@/components/DashboardNav";

export const metadata = {
  title: "Dashboard",
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    return null; // middleware will redirect
  }

  const positions = await getPositionsByUserId(session.user.id);
  const today = new Date().toISOString().slice(0, 10);

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

        {/* Add position form */}
        <form
          action={addPositionAction}
          className="mb-10 rounded-xl border border-navy-200 bg-white p-6"
        >
          <h2 className="mb-4 text-lg font-semibold text-navy-900">
            Add a position
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="ticker"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Ticker
              </label>
              <input
                id="ticker"
                name="ticker"
                type="text"
                required
                placeholder="AAPL"
                maxLength={10}
                className="w-full rounded-lg border border-navy-300 px-3 py-2 uppercase focus:border-navy-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="purchasePrice"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Purchase price
              </label>
              <input
                id="purchasePrice"
                name="purchasePrice"
                type="number"
                step="0.0001"
                min="0"
                required
                placeholder="150.00"
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="purchaseDate"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Purchase date
              </label>
              <input
                id="purchaseDate"
                name="purchaseDate"
                type="date"
                required
                defaultValue={today}
                max={today}
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              type="submit"
              className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Add position
            </button>
          </div>
        </form>

        {/* Positions list */}
        {positions.length > 0 && (
          <div className="space-y-3">
            {positions.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-navy-200 bg-white p-5"
              >
                <div>
                  <div className="text-lg font-semibold text-navy-900">
                    {p.ticker}
                  </div>
                  <div className="text-sm text-navy-500">
                    Bought at ${Number(p.purchase_price).toFixed(2)} on {p.purchase_date}
                  </div>
                </div>
                <form action={deletePositionAction}>
                  <input type="hidden" name="positionId" value={p.id} />
                  <button
                    type="submit"
                    className="text-sm text-navy-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
