import Link from "next/link";
import { auth } from "@/auth";
import { listTickerStates, type TickerState } from "@/lib/tickerStates";
import { listLivedPositionIdsByTicker } from "@/lib/positions";
import DashboardNav from "@/components/DashboardNav";
import { reanalyzeTickerAction } from "../actions";

export const metadata = {
  title: "History",
};

const SECTIONS: Array<{
  key: "discarded" | "outside_circle";
  title: string;
  blurb: string;
}> = [
  {
    key: "discarded",
    title: "Discarded",
    blurb:
      "Businesses you analyzed and decided not to invest in or track further.",
  },
  {
    key: "outside_circle",
    title: "Outside circle of competence",
    blurb:
      "Businesses you flagged as outside what you understand well enough to own.",
  },
];

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const [discarded, outsideCircle, livedPositions] = await Promise.all([
    listTickerStates({ userId: session.user.id, status: "discarded" }),
    listTickerStates({ userId: session.user.id, status: "outside_circle" }),
    listLivedPositionIdsByTicker(session.user.id),
  ]);

  const groups: Record<"discarded" | "outside_circle", TickerState[]> = {
    discarded,
    outside_circle: outsideCircle,
  };

  const total = discarded.length + outsideCircle.length;

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

        {total === 0 && (
          <div className="rounded-xl border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-navy-700 hover:text-navy-900"
            >
              Go to your portfolio to start an analysis →
            </Link>
          </div>
        )}

        {SECTIONS.map((section) => {
          const items = groups[section.key];
          if (items.length === 0) return null;
          return (
            <section key={section.key} className="mb-10">
              <h2 className="text-lg font-semibold text-navy-900">
                {section.title}{" "}
                <span className="ml-1 text-sm font-normal text-navy-500">
                  · {items.length}
                </span>
              </h2>
              <p className="mb-3 text-sm text-navy-600">{section.blurb}</p>
              <div className="space-y-3">
                {items.map((item) => {
                  // A discarded ticker that has an underlying lived position
                  // (was bought at some point, now closed) gets "Open ficha"
                  // instead of "Re-analyze" — Re-analyze for these would
                  // just redirect to the same position page anyway, so the
                  // direct link is more honest.
                  const livedPositionId = livedPositions.get(item.ticker);
                  const wasHeld = livedPositionId !== undefined;
                  return (
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
                              {formatDate(item.last_touched_at)}
                            </span>
                            {wasHeld && (
                              <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">
                                Was held
                              </span>
                            )}
                          </div>
                          {item.reason_md && (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-navy-600">
                              {item.reason_md}
                            </p>
                          )}
                        </div>
                        {wasHeld ? (
                          <Link
                            href={`/dashboard/position/${livedPositionId}`}
                            className="rounded-lg border border-navy-300 px-3 py-1.5 text-sm text-navy-700 hover:border-navy-900 hover:text-navy-900"
                          >
                            Open ficha →
                          </Link>
                        ) : (
                          <form action={reanalyzeTickerAction}>
                            <input
                              type="hidden"
                              name="ticker"
                              value={item.ticker}
                            />
                            <button
                              type="submit"
                              className="rounded-lg border border-navy-300 px-3 py-1.5 text-sm text-navy-700 hover:border-navy-900 hover:text-navy-900"
                            >
                              Re-analyze
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
