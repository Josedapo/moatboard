import Link from "next/link";
import { auth } from "@/auth";
import { getPositionsByUserId } from "@/lib/positions";
import { listSignalsForUser } from "@/lib/reviewSignals";
import { getLatestCronRun } from "@/lib/cronRuns";
import DashboardNav from "@/components/DashboardNav";
import SignalsInbox from "@/components/SignalsInbox";

export const metadata = {
  title: "Inbox · Moatboard",
};

// The inbox shows pending (new) signals only. Revisadas viven en la
// pestaña "Presentaciones" de la ficha de cada empresa (o en la vista
// de watchlist por ticker), no aquí.
export default async function InboxPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [positions, signals, cronRun] = await Promise.all([
    getPositionsByUserId(session.user.id),
    listSignalsForUser({ userId: session.user.id, status: "new" }),
    getLatestCronRun("signals_daily"),
  ]);

  const positionIdByTicker: Record<string, number | null> = {};
  for (const p of positions) positionIdByTicker[p.ticker] = p.id;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-navy-950">Inbox</h1>
            <p className="mt-2 text-navy-600">
              Señales pendientes de revisar para tus tickers activos (cartera +
              watchlist): SEC EDGAR, movimientos de fondos curados y compras de
              insiders. Al marcarlas como revisadas pasan al apartado{" "}
              <strong>Señales</strong> de la empresa.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; Volver al portfolio
          </Link>
        </header>

        <SignalsInbox
          signals={signals}
          positionIdByTicker={positionIdByTicker}
          cronRun={cronRun}
        />
      </main>
    </div>
  );
}
