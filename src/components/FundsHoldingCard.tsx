import Link from "next/link";
import type { FundHoldingTicker } from "@/lib/discoveryFund";

const TIER_LABEL: Record<string, string> = {
  A: "Quality Compounders",
  B: "Value",
  C: "Growth / GARP",
  D: "Concentrated",
  E: "Hedge funds (long book)",
};

const TIER_CHIP: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-teal-100 text-teal-800",
  C: "bg-navy-100 text-navy-700",
  D: "bg-navy-100 text-navy-700",
  E: "bg-navy-50 text-navy-500",
};

// "Smart money exposure" card for the position/watchlist Overview.
// Shows which curated funds currently hold the business, grouped by
// tier (A→E), with the per-fund weight as the primary signal. Empty
// state when no curated fund holds the ticker — common for small-caps
// or recently-IPO'd businesses outside the consensus circle.
export default function FundsHoldingCard({
  ticker,
  funds,
}: {
  ticker: string;
  funds: FundHoldingTicker[];
}) {
  if (funds.length === 0) {
    return (
      <section className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-navy-900">
          Fondos curados que mantienen {ticker}
        </h3>
        <p className="mt-2 text-xs italic text-navy-500">
          Ninguno de los 31 fondos seleccionados tiene esta empresa en su
          última declaración 13F. Puede ser una small-cap fuera del
          consenso o una idea propia — ausencia no es señal en sí misma.
        </p>
      </section>
    );
  }

  const grouped = groupByTier(funds);
  const totalFunds = funds.length;

  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">
          Fondos curados que mantienen {ticker}
        </h3>
        <span className="text-[11px] text-navy-500">
          {totalFunds} {totalFunds === 1 ? "fondo" : "fondos"} · datos
          del último 13F-HR
        </span>
      </header>

      <div className="space-y-3">
        {grouped.map(({ tier, funds: tierFunds }) => (
          <div key={tier}>
            <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-navy-600">
              <span
                className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_CHIP[tier]}`}
              >
                {tier}
              </span>
              <span>{TIER_LABEL[tier]}</span>
              <span className="text-navy-400">· {tierFunds.length}</span>
            </p>
            <ul className="ml-1 grid grid-cols-1 gap-1 text-xs text-navy-700 sm:grid-cols-2">
              {tierFunds.map((f) => (
                <li
                  key={f.cik}
                  className="flex items-center justify-between rounded border border-navy-100 bg-white px-2 py-1.5"
                >
                  <Link
                    href={`/dashboard/discovery/fund/${f.cik}`}
                    className="truncate text-navy-700 hover:text-navy-900 hover:underline"
                  >
                    {f.display_name}
                    {f.actual_ticker !== ticker && (
                      <span className="ml-1 text-[10px] text-navy-400">
                        (vía {f.actual_ticker})
                      </span>
                    )}
                  </Link>
                  <span className="ml-2 shrink-0 font-mono tabular-nums text-navy-500">
                    {f.weight_in_fund.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function groupByTier(
  funds: FundHoldingTicker[],
): Array<{ tier: "A" | "B" | "C" | "D" | "E"; funds: FundHoldingTicker[] }> {
  const buckets: Record<string, FundHoldingTicker[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
  };
  for (const f of funds) buckets[f.tier].push(f);
  const order: Array<"A" | "B" | "C" | "D" | "E"> = ["A", "B", "C", "D", "E"];
  return order
    .filter((t) => buckets[t].length > 0)
    .map((t) => ({ tier: t, funds: buckets[t] }));
}
