// Server Component. Lives in the Calidad tab, between MoatboardAnalysis
// (quality scorecard) and — today — nothing else. Frames insider
// purchases as a management signaling quality-adjacent read: management
// putting their own money into the business they run is a proxy for
// conviction, not a news feed.
//
// Renders null when no qualifying transactions in the window — same
// "hide when empty" discipline as Additional Signals cards in
// MoatboardAnalysis.tsx.

import { summarizeRecentInsiderPurchases } from "@/lib/insiderTransactions";

export default async function InsiderPurchasesCard({
  ticker,
}: {
  ticker: string;
}) {
  const summary = await summarizeRecentInsiderPurchases({
    ticker,
    sinceDays: 90,
  });

  if (summary.transaction_count === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">
          Compras de insiders · últimos {summary.window_days} días
        </h3>
        <span className="text-xs text-navy-500">
          {summary.insider_count}{" "}
          {summary.insider_count === 1 ? "insider" : "insiders"} ·{" "}
          {formatUsd(summary.total_value_usd)} agregado
        </span>
      </header>
      <p className="mt-1 text-xs text-navy-500">
        Solo compras discrecionales en mercado abierto (transaction code P),
        excluyendo planes 10b5-1. Compras &lt;$50K están incluidas únicamente
        cuando el insider es CEO o CFO.
      </p>
      <ul className="mt-4 space-y-2">
        {summary.top_transactions.map((t, i) => (
          <li
            key={`${t.transaction_date}-${t.reporting_owner_name}-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-navy-100 bg-navy-50/40 px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-navy-900">
                  {t.reporting_owner_name}
                </span>
                {t.reporting_owner_title && (
                  <span className="truncate text-xs text-navy-600">
                    {t.reporting_owner_title}
                  </span>
                )}
                {t.is_officer && (
                  <span className="inline-flex rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                    Officer
                  </span>
                )}
                {t.is_director && !t.is_officer && (
                  <span className="inline-flex rounded-md border border-teal-300 bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-800">
                    Director
                  </span>
                )}
                {t.is_ten_percent_owner && (
                  <span className="inline-flex rounded-md border border-navy-200 bg-navy-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">
                    10%+ owner
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-navy-500">
                {formatDate(t.transaction_date)} ·{" "}
                {formatShares(t.shares)} shares @ ${t.price_per_share.toFixed(2)} ·{" "}
                <span className="font-semibold text-navy-700">
                  {formatUsd(t.transaction_value_usd)}
                </span>
                {t.direct_or_indirect === "I" && (
                  <span className="ml-1 text-navy-400">(indirecta)</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {summary.transaction_count > summary.top_transactions.length && (
        <p className="mt-3 text-[11px] text-navy-500">
          Mostrando {summary.top_transactions.length} de{" "}
          {summary.transaction_count} operaciones.
        </p>
      )}
    </section>
  );
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatShares(shares: number): string {
  if (shares >= 1_000_000) return `${(shares / 1_000_000).toFixed(2)}M`;
  if (shares >= 1_000) return `${(shares / 1_000).toFixed(1)}K`;
  return shares.toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

function formatDate(ymd: string): string {
  try {
    const d = new Date(ymd + "T00:00:00Z");
    return d.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return ymd;
  }
}
