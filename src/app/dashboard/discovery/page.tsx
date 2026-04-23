import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { computeLeaderboard } from "@/lib/discoveryLeaderboard";
import { computeDeltaWindow } from "@/lib/discoveryDelta";
import { listRecentFilingsForUser } from "@/lib/discoveryRecentFilings";
import DashboardNav from "@/components/DashboardNav";
import DiscoveryLeaderboard from "@/components/DiscoveryLeaderboard";
import DiscoveryNewEntrants from "@/components/DiscoveryNewEntrants";
import DiscoveryRecentFilingsPanel from "@/components/DiscoveryRecentFilingsPanel";
import AnalyzeEntryForm from "@/components/AnalyzeEntryForm";

export const metadata = {
  title: "Discovery · Moatboard",
};

// Consensus-holdings leaderboard sourced from 31 curated world-class
// funds' 13F-HR filings. Quality-aligned managers (Tier A, weight 3.0)
// outweigh growth hedges (Tier E, 0.5) in the conviction score, so
// mega-caps everyone already knows don't auto-dominate the top of the
// table — the signal is which names Tier A funds converge on.
//
// Anti-trading framing (deliberate): no price data, no "last updated
// 3 days ago", no activity feed, no "biggest additions this quarter"
// sort. Discovery surfaces CANDIDATES — the analysis wizard decides.
export default async function DiscoveryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const [{ rows, meta }, delta, recentFilings] = await Promise.all([
    computeLeaderboard(session.user.id),
    computeDeltaWindow(session.user.id),
    listRecentFilingsForUser({ userId: session.user.id }),
  ]);
  const quarterLabel = meta.latestQuarter
    ? formatQuarter(meta.latestQuarter)
    : "—";

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-navy-950">Discovery</h1>
            <Link
              href="/dashboard/discovery/funds"
              className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
            >
              Ver fondos →
            </Link>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-navy-600">
            Empresas que aparecen en la cartera de los {meta.fundsCovered} fondos
            curados, ordenadas por conviction score (suma ponderada por tier
            del peso que cada fondo le da a la posición). Punto de partida
            para el análisis, no recomendación de compra — la decisión
            siempre pasa por el scorecard de calidad y la valoración.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-500">
            <span>
              Datos del trimestre <strong>{quarterLabel}</strong>
            </span>
            <span>
              {meta.fundsCovered} fondos · {rows.length} tickers distintos
            </span>
          </div>
        </header>

        <section className="mb-6">
          <AnalyzeEntryForm variant="inline" />
        </section>

        <section className="mb-6">
          <DiscoveryRecentFilingsPanel filings={recentFilings} />
        </section>

        <section className="mb-6">
          <DiscoveryNewEntrants
            entrants={delta.newEntrants}
            latestQuarter={delta.latestQuarter}
            priorQuarter={delta.priorQuarter}
          />
        </section>

        <DiscoveryLeaderboard rows={rows} />
      </main>
    </div>
  );
}

// "2025-12-31" → "Q4 2025". Keeps the anti-trading vibe — we never
// show "updated 2 weeks ago" because freshness numbing is the enemy.
function formatQuarter(ymd: string): string {
  const [yStr, mStr] = ymd.split("-");
  const month = Number(mStr);
  const quarter =
    month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${quarter} ${yStr}`;
}
