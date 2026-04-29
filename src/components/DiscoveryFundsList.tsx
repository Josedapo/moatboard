"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FundListRow } from "@/lib/discoveryFundList";
import {
  nextExpected13FDeadline,
  quarterLabelFromIso,
  shortDateEs,
} from "@/lib/thirteenFCadence";

type SortKey =
  | "display_name"
  | "total_value_usd"
  | "holdings_count"
  | "top5_pct"
  | "movements_count"
  | "period_of_report";

type SortDir = "asc" | "desc";

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

const SORT_DEFAULTS: Record<SortKey, SortDir> = {
  display_name: "asc",
  total_value_usd: "desc",
  holdings_count: "desc",
  top5_pct: "desc",
  movements_count: "desc",
  // Sorting by period_of_report ascending = soonest next deadline first
  // (older latest period → next deadline is closer in calendar time).
  // The column label is "Próximo 13F" so the user-meaningful default is
  // "imminent first".
  period_of_report: "asc",
};

export default function DiscoveryFundsList({
  funds,
}: {
  funds: FundListRow[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(SORT_DEFAULTS[key]);
    }
  };

  // Group by tier, preserving roster order within groups when
  // alphabetical; otherwise sort within-group by the selected column.
  const grouped = useMemo(() => {
    const byTier: Record<string, FundListRow[]> = {
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
    };
    for (const f of funds) {
      byTier[f.tier]?.push(f);
    }
    for (const t of Object.keys(byTier)) {
      byTier[t].sort((a, b) => compareRows(a, b, sortKey, sortDir));
    }
    return byTier;
  }, [funds, sortKey, sortDir]);

  const tiers = (["A", "B", "C", "D", "E"] as const).filter(
    (t) => grouped[t].length > 0,
  );

  return (
    <div className="space-y-6">
      {tiers.map((t) => (
        <section key={t}>
          <header className="mb-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold ${TIER_CHIP[t]}`}
            >
              Tier {t}
            </span>
            <h2 className="text-sm font-semibold text-navy-900">
              {TIER_LABEL[t]}
            </h2>
            <span className="text-xs text-navy-400">
              · {grouped[t].length}
            </span>
          </header>
          <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-navy-100 bg-navy-50 text-xs uppercase tracking-wider text-navy-600">
                <tr>
                  <SortHeader
                    label="Fondo"
                    active={sortKey === "display_name"}
                    dir={sortDir}
                    onClick={() => handleSort("display_name")}
                    align="left"
                  />
                  <SortHeader
                    label="Valor cartera"
                    active={sortKey === "total_value_usd"}
                    dir={sortDir}
                    onClick={() => handleSort("total_value_usd")}
                    align="right"
                  />
                  <SortHeader
                    label="Posiciones"
                    active={sortKey === "holdings_count"}
                    dir={sortDir}
                    onClick={() => handleSort("holdings_count")}
                    align="right"
                  />
                  <SortHeader
                    label="Top 5"
                    active={sortKey === "top5_pct"}
                    dir={sortDir}
                    onClick={() => handleSort("top5_pct")}
                    align="right"
                  />
                  <SortHeader
                    label="Movs. Q"
                    active={sortKey === "movements_count"}
                    dir={sortDir}
                    onClick={() => handleSort("movements_count")}
                    align="right"
                  />
                  <SortHeader
                    label="Próximo 13F"
                    active={sortKey === "period_of_report"}
                    dir={sortDir}
                    onClick={() => handleSort("period_of_report")}
                    align="left"
                  />
                </tr>
              </thead>
              <tbody>
                {grouped[t].map((f) => (
                  <FundRow key={f.cik} fund={f} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function FundRow({ fund }: { fund: FundListRow }) {
  return (
    <tr className="border-b border-navy-50 hover:bg-navy-50/40">
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/discovery/fund/${fund.cik}`}
          className="block"
        >
          <div className="text-sm font-semibold text-navy-900 hover:underline">
            {fund.display_name}
          </div>
          {fund.philosophy && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-navy-500">
              {fund.philosophy}
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-900">
        {fund.total_value_usd != null
          ? `$${formatBillions(fund.total_value_usd)}`
          : "—"}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-700">
        {fund.holdings_count ?? "—"}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-700">
        {fund.top5_pct != null ? `${fund.top5_pct.toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-navy-700">
        {fund.movements_count ?? "—"}
      </td>
      <td className="px-4 py-3">
        <NextFilingCell periodOfReport={fund.period_of_report} />
      </td>
    </tr>
  );
}

function NextFilingCell({
  periodOfReport,
}: {
  periodOfReport: string | null;
}) {
  if (!periodOfReport) {
    return <span className="text-xs text-navy-400">—</span>;
  }
  const next = nextExpected13FDeadline(periodOfReport);
  const tone =
    next.status === "overdue"
      ? "text-red-700"
      : next.status === "imminent"
        ? "text-amber-700"
        : "text-navy-700";
  const daysLabel =
    next.status === "overdue"
      ? `${Math.abs(next.daysUntilDeadline)}d retraso`
      : next.daysUntilDeadline === 0
        ? "hoy"
        : `${next.daysUntilDeadline}d`;
  const lastQuarter = quarterLabelFromIso(periodOfReport);
  return (
    <div
      className="leading-tight"
      title={`Último 13F entregado: ${lastQuarter} (period ${periodOfReport}). Próxima presentación esperada antes del ${shortDateEs(next.deadline)} (${quarterLabelFromIso(next.nextPeriod)}).`}
    >
      <div className={`text-xs font-semibold tabular-nums ${tone}`}>
        {quarterLabelFromIso(next.nextPeriod)} · {daysLabel}
      </div>
      <div className="mt-0.5 text-[10px] text-navy-400">
        antes del {shortDateEs(next.deadline)}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align: "left" | "right";
}) {
  const alignClass =
    align === "right" ? "text-right justify-end" : "text-left justify-start";
  const textClass = active ? "text-navy-900" : "text-navy-600";
  return (
    <th className={`px-4 py-3 font-semibold ${alignClass.split(" ")[0]}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${alignClass.split(" ")[1]} ${textClass} hover:text-navy-900`}
      >
        <span>{label}</span>
        <span
          aria-hidden
          className={active ? "text-navy-700" : "text-navy-300"}
        >
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function compareRows(
  a: FundListRow,
  b: FundListRow,
  key: SortKey,
  dir: SortDir,
): number {
  const mult = dir === "asc" ? 1 : -1;
  const av = valueFor(a, key);
  const bv = valueFor(b, key);

  if (av === null && bv === null) return 0;
  if (av === null) return 1; // nulls last regardless of direction
  if (bv === null) return -1;

  if (typeof av === "number" && typeof bv === "number") {
    return (av - bv) * mult;
  }
  return String(av).localeCompare(String(bv)) * mult;
}

function valueFor(row: FundListRow, key: SortKey): string | number | null {
  switch (key) {
    case "display_name":
      return row.display_name.toUpperCase();
    case "total_value_usd":
      return row.total_value_usd;
    case "holdings_count":
      return row.holdings_count;
    case "top5_pct":
      return row.top5_pct;
    case "movements_count":
      return row.movements_count;
    case "period_of_report":
      return row.period_of_report;
  }
}

function formatBillions(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString("en-US");
}

