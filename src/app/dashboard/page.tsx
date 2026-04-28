import Link from "next/link";
import { auth } from "@/auth";
import { getPositionsByUserId } from "@/lib/positions";
import { getCostBasis } from "@/lib/positionTransactions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { listWatchlist } from "@/lib/watchlistEntries";
import { countNewSignalsByTicker } from "@/lib/reviewSignals";
import { getLatestCronRun } from "@/lib/cronRuns";
import DashboardNav from "@/components/DashboardNav";
import AnalyzeEntryForm from "@/components/AnalyzeEntryForm";
import AddPositionForm from "@/components/AddPositionForm";
import UpcomingEarnings, {
  type UpcomingEarning,
} from "@/components/UpcomingEarnings";

export const metadata = {
  title: "Dashboard",
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    return null; // proxy will redirect
  }

  const [
    positions,
    watchlist,
    signalCountsByTicker,
    lastSignalsRun,
    lastDiscoveryRun,
  ] = await Promise.all([
    getPositionsByUserId(session.user.id),
    listWatchlist({ userId: session.user.id }),
    countNewSignalsByTicker(session.user.id),
    getLatestCronRun("signals_daily"),
    getLatestCronRun("discovery_weekly"),
  ]);

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

  // Watchlist quotes — needed only for the earnings date; no cost basis,
  // no fundamentals panel. Same upstream module so the extra request is
  // identical in shape to the ones we already do.
  const watchlistQuotes = await Promise.all(
    watchlist.map(async (w) => {
      const { quote } = await fetchQuoteAndFundamentals(w.ticker);
      return { ticker: w.ticker, quote };
    }),
  );

  // Portfolio-level totals for the KPI strip. Positions without a
  // resolved currentPrice drop out of the "Valor ahora" side but still
  // count toward "Invertido" so the strip doesn't contradict the list.
  const totals = enriched.reduce(
    (acc, { quote, costBasis }) => {
      const shares = costBasis.shares ?? 0;
      const avg = costBasis.avg_cost_per_share ?? 0;
      const price = quote?.regularMarketPrice ?? null;
      acc.invested += shares * avg;
      if (price !== null) acc.now += shares * price;
      return acc;
    },
    { invested: 0, now: 0 },
  );
  const deltaAbs = totals.now - totals.invested;
  const deltaPct =
    totals.invested > 0 ? (deltaAbs / totals.invested) * 100 : null;

  const upcomingEarnings: UpcomingEarning[] = buildUpcomingEarnings({
    portfolio: enriched.map(({ position, quote }) => ({
      ticker: position.ticker,
      positionId: position.id,
      earningsDateIso: quote?.nextEarningsDate ?? null,
      companyName: quote?.longName ?? quote?.shortName ?? null,
    })),
    watchlist: watchlistQuotes.map(({ ticker, quote }) => ({
      ticker,
      positionId: null,
      earningsDateIso: quote?.nextEarningsDate ?? null,
      companyName: quote?.longName ?? quote?.shortName ?? null,
    })),
  });

  const heartbeatLine = buildHeartbeat({ lastSignalsRun, lastDiscoveryRun });

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-14 py-12">
        <div className="grid grid-cols-[1fr_260px] gap-14">
          {/* ─── Main column ─── */}
          <div>
            {/* KPI strip · design-system §4.2 */}
            <div className="grid grid-cols-4 border-y border-rule-soft mb-10">
              <Kpi label="Posiciones" value={formatInt(positions.length)} />
              <Kpi
                label="Invertido"
                value={`$${formatCommas(totals.invested)}`}
              />
              <Kpi
                label="Valor ahora"
                value={`$${formatCommas(totals.now)}`}
              />
              <Kpi
                label="Δ vs coste"
                value={
                  deltaPct === null
                    ? "—"
                    : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`
                }
                tone={
                  deltaPct === null
                    ? "neutral"
                    : deltaPct >= 0
                      ? "pos"
                      : "neg"
                }
                isLast
              />
            </div>

            {enriched.length > 0 ? (
              <>
                <h2 className="flex items-baseline justify-between border-b border-rule-soft pb-2 mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-70">
                  <span>Empresas en cartera</span>
                  <span className="flex items-center gap-4 font-display text-[13px] italic font-normal text-ink-50 normal-case tracking-normal">
                    <span>Ordenadas por incorporación</span>
                    <AddPositionForm />
                  </span>
                </h2>

                <div>
                  {enriched.map(({ position: p, quote, costBasis }) => {
                    const avgCost = costBasis.avg_cost_per_share;
                    const shares = costBasis.shares ?? 0;
                    const currentPrice = quote?.regularMarketPrice ?? null;
                    const invested =
                      avgCost !== null ? shares * avgCost : null;
                    const now =
                      currentPrice !== null ? shares * currentPrice : null;
                    const deltaAbs =
                      invested !== null && now !== null ? now - invested : null;
                    const changePct =
                      currentPrice !== null && avgCost !== null && avgCost > 0
                        ? ((currentPrice - avgCost) / avgCost) * 100
                        : null;
                    const positive = changePct !== null && changePct >= 0;
                    const signalCount = signalCountsByTicker[p.ticker] ?? 0;

                    const subtle = [quote?.sector, quote?.industry]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <Link
                        key={p.id}
                        href={`/dashboard/ticker/${p.ticker}`}
                        className="no-underline text-ink"
                      >
                        <div className="grid grid-cols-[110px_1fr_160px_130px] gap-6 items-center py-5 border-b border-rule-soft last:border-b-0">
                          {/* Ticker cell */}
                          <div className="font-display text-[28px] leading-none tracking-[-0.01em]">
                            <span className="whitespace-nowrap">
                              {p.ticker}
                              {signalCount > 0 && (
                                <span
                                  className="ml-1 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-amber px-[5px] font-sans text-[9px] font-semibold leading-none text-paper relative top-[-2px]"
                                  aria-label={`${signalCount} señales nuevas`}
                                >
                                  {signalCount > 99 ? "99+" : signalCount}
                                </span>
                              )}
                            </span>
                            {quote?.exchange && (
                              <span className="block mt-1.5 font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-ink-70">
                                {quote.exchange}
                              </span>
                            )}
                          </div>

                          {/* Company */}
                          <div>
                            <div className="font-display text-[18px] font-normal leading-[1.35]">
                              {quote?.longName ?? quote?.shortName ?? p.ticker}
                            </div>
                            {subtle && (
                              <div className="mt-1.5 font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-ink-70">
                                {subtle}
                              </div>
                            )}
                          </div>

                          {/* Cost cell */}
                          <div className="text-right font-sans text-[12px] text-ink-50 tabular-nums leading-[1.5]">
                            <span className="block font-display text-[22px] font-normal leading-none mb-1 text-ink oldstyle-nums">
                              {currentPrice !== null
                                ? `$${currentPrice.toFixed(2)}`
                                : "—"}
                            </span>
                            {avgCost !== null && shares > 0
                              ? `${formatShares(shares)} shares · avg $${avgCost.toFixed(2)}`
                              : "Sin transacciones"}
                          </div>

                          {/* Change cell */}
                          <div
                            className={`text-right font-display text-[20px] font-normal leading-none tabular-nums ${
                              changePct === null
                                ? "text-ink-50"
                                : positive
                                  ? "text-emerald"
                                  : "text-red"
                            }`}
                          >
                            {deltaAbs !== null
                              ? `${deltaAbs >= 0 ? "+" : "−"}$${Math.abs(deltaAbs).toFixed(0)}`
                              : "—"}
                            {changePct !== null && (
                              <span className="block font-sans text-[11px] font-medium mt-1 tracking-[0.02em]">
                                {changePct >= 0 ? "+" : ""}
                                {changePct.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="font-display text-[16px] italic text-ink-70">
                Sin posiciones aún. Añade el primer negocio que quieras seguir.
              </p>
            )}
          </div>

          {/* ─── Aside ─── */}
          <aside className="border-l border-rule-soft pl-9">
            <section className="mb-10">
              <h3 className="mb-3.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-70">
                Analizar un negocio
              </h3>
              <AnalyzeEntryForm />
            </section>

            <section className="mb-10">
              <h3 className="mb-3.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-70">
                Próximas presentaciones
              </h3>
              <UpcomingEarnings entries={upcomingEarnings} />
            </section>

            <section>
              <h3 className="mb-3.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-70">
                Heartbeat
              </h3>
              <p className="m-0 font-display text-[13.5px] italic leading-[1.5] text-ink-70">
                {heartbeatLine}
              </p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

// ─── KPI cell ───

function Kpi({
  label,
  value,
  tone = "neutral",
  isLast = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg";
  isLast?: boolean;
}) {
  const toneClass =
    tone === "pos" ? "text-emerald" : tone === "neg" ? "text-red" : "text-ink";
  return (
    <div
      className={`px-4 py-4 ${isLast ? "" : "border-r border-rule-soft"}`}
    >
      <div className="mb-2 font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-ink-70">
        {label}
      </div>
      <div
        className={`font-display text-[28px] font-normal leading-none oldstyle-nums ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Formatting helpers ───

function formatShares(shares: number): string {
  return shares.toFixed(4).replace(/\.?0+$/, "");
}

function formatCommas(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function formatInt(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ─── Heartbeat line ───

function buildHeartbeat(input: {
  lastSignalsRun: { started_at: string; inserted_signals: number | null } | null;
  lastDiscoveryRun: { started_at: string } | null;
}): string {
  const parts: string[] = [];
  if (input.lastSignalsRun) {
    const ago = relativeTimeFromNow(
      new Date(input.lastSignalsRun.started_at),
    );
    const inserted = input.lastSignalsRun.inserted_signals ?? 0;
    parts.push(
      `SEC cron: última revisión ${ago} · ${inserted} señales nuevas`,
    );
  } else {
    parts.push("SEC cron: sin historial de ejecuciones");
  }
  if (input.lastDiscoveryRun) {
    const ago = relativeTimeFromNow(
      new Date(input.lastDiscoveryRun.started_at),
    );
    parts.push(`Discovery cron: ${ago}`);
  }
  return parts.join(". ") + ".";
}

function relativeTimeFromNow(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} ${diffH === 1 ? "hora" : "horas"}`;
  const diffD = Math.round(diffH / 24);
  return `hace ${diffD} ${diffD === 1 ? "día" : "días"}`;
}

// ─── Upcoming earnings builder ───

type RawEarningsEntry = {
  ticker: string;
  positionId: number | null;
  earningsDateIso: string | null;
  companyName: string | null;
};

function buildUpcomingEarnings(input: {
  portfolio: RawEarningsEntry[];
  watchlist: RawEarningsEntry[];
}): UpcomingEarning[] {
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const result: UpcomingEarning[] = [];
  const seen = new Set<string>();

  for (const e of [...input.portfolio, ...input.watchlist]) {
    if (!e.earningsDateIso) continue;
    if (seen.has(e.ticker)) continue; // portfolio wins over watchlist
    seen.add(e.ticker);

    const ms = new Date(e.earningsDateIso).getTime();
    if (!Number.isFinite(ms)) continue;
    const daysAway = Math.round((ms - now) / dayMs);

    result.push({
      ticker: e.ticker,
      companyName: e.companyName,
      positionId: e.positionId,
      earningsDate: e.earningsDateIso,
      daysAway,
    });
  }

  result.sort(
    (a, b) =>
      new Date(a.earningsDate).getTime() - new Date(b.earningsDate).getTime(),
  );
  return result;
}
