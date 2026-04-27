"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { reanalyzeTickerAction } from "@/app/dashboard/actions";
import type {
  BusinessTier,
  LeaderboardRow,
  FundInPosition,
} from "@/lib/discoveryLeaderboard";
import {
  BusinessTierChip,
  FlagsBadge,
} from "@/components/shared/BusinessSignalChips";

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

type FilterKey = "unseen" | "all" | "in_portfolio" | "watchlist" | "discarded";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "unseen", label: "Sin analizar" },
  { key: "in_portfolio", label: "En cartera" },
  { key: "watchlist", label: "Watchlist" },
  { key: "discarded", label: "Descartadas" },
];

type TierFilterKey =
  | "all"
  | "exceptional_only"
  | "good_plus"
  | "mediocre_plus"
  | "no_tier";

const TIER_FILTERS: { key: TierFilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "exceptional_only", label: "Solo Exceptional" },
  { key: "good_plus", label: "Good+" },
  { key: "mediocre_plus", label: "Mediocre+" },
  { key: "no_tier", label: "Sin tier aún" },
];

type FlagsFilterKey = "all" | "no_serious" | "with_serious";

const FLAGS_FILTERS: { key: FlagsFilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "no_serious", label: "Sin red flags graves" },
  { key: "with_serious", label: "Con red flags graves" },
];

// Order: best to worst. Used by tier filters to gate "X+".
const TIER_ORDER: BusinessTier[] = ["exceptional", "good", "mediocre", "poor"];

const STATE_STYLE: Record<
  string,
  { label: string; chip: string }
> = {
  in_portfolio: {
    label: "En cartera",
    chip: "bg-emerald-100 text-emerald-800",
  },
  watchlist: {
    label: "Watchlist",
    chip: "bg-amber-100 text-amber-800",
  },
  discarded: {
    label: "Descartada",
    chip: "bg-navy-100 text-navy-600",
  },
};

type SortKey =
  | "ticker"
  | "issuer"
  | "tier"
  | "conviction"
  | "n_funds"
  | "state";
type SortDir = "asc" | "desc";

// Higher value = earlier in the "natural" state sort order: unseen
// first (actionable), then owned/watchlist, then discards. Sort desc
// surfaces unseen at the top.
const STATE_RANK: Record<string, number> = {
  "": 4, // unseen
  in_portfolio: 3,
  watchlist: 2,
  discarded: 1,
};

// Higher = better. Sort desc surfaces exceptional first; un-analyzed rows
// (null tier) go to the end because 0 is below any tier.
const TIER_RANK: Record<BusinessTier, number> = {
  exceptional: 4,
  good: 3,
  mediocre: 2,
  poor: 1,
};

// Client wrapper for the leaderboard: client-side filter + sort across
// the pre-computed rows. Server does the heavy SQL aggregation; this
// component is thin, just presentation + state for interactive UX.
export default function DiscoveryLeaderboard({
  rows,
}: {
  rows: LeaderboardRow[];
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [tierFilter, setTierFilter] = useState<TierFilterKey>("all");
  const [flagsFilter, setFlagsFilter] = useState<FlagsFilterKey>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("conviction");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Sensible defaults: numeric columns desc, text columns asc.
      setSortDir(
        key === "ticker" || key === "issuer" || key === "state"
          ? "asc"
          : "desc",
      );
    }
  };

  const toggleExpanded = (ticker: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const passed = rows.filter((r) => {
      if (filter === "unseen" && r.ticker_state) return false;
      if (filter === "in_portfolio" && r.ticker_state !== "in_portfolio")
        return false;
      if (filter === "watchlist" && r.ticker_state !== "watchlist")
        return false;
      if (filter === "discarded" && r.ticker_state !== "discarded")
        return false;
      if (q && !r.ticker.includes(q) && !r.issuer_name.toUpperCase().includes(q))
        return false;

      // Tier filter (agent or user verdict, doesn't matter — both are
      // tier on the same scale).
      if (tierFilter !== "all") {
        if (tierFilter === "no_tier") {
          if (r.business_tier !== null) return false;
        } else if (tierFilter === "exceptional_only") {
          if (r.business_tier !== "exceptional") return false;
        } else {
          // good_plus / mediocre_plus: rank-based "at-or-better" gate.
          // Untiered rows fail because we can't claim they meet the bar.
          if (r.business_tier === null) return false;
          const minRank =
            tierFilter === "good_plus"
              ? TIER_ORDER.indexOf("good")
              : TIER_ORDER.indexOf("mediocre");
          const tierRank = TIER_ORDER.indexOf(r.business_tier);
          if (tierRank > minRank) return false;
        }
      }

      // Flags filter — only meaningful for analyzed rows. Untiered rows
      // pass when "all", fail otherwise (we can't evaluate flags we
      // haven't computed).
      if (flagsFilter !== "all") {
        if (r.business_tier === null) return false;
        if (flagsFilter === "no_serious" && r.serious_flag_count > 0)
          return false;
        if (flagsFilter === "with_serious" && r.serious_flag_count === 0)
          return false;
      }

      return true;
    });

    const mult = sortDir === "asc" ? 1 : -1;
    return [...passed].sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return a.ticker.localeCompare(b.ticker) * mult;
        case "issuer":
          return a.issuer_name.localeCompare(b.issuer_name) * mult;
        case "conviction":
          return (a.conviction_score - b.conviction_score) * mult;
        case "n_funds":
          return (a.n_funds - b.n_funds) * mult;
        case "tier": {
          const ra = a.business_tier ? TIER_RANK[a.business_tier] : 0;
          const rb = b.business_tier ? TIER_RANK[b.business_tier] : 0;
          if (ra !== rb) return (ra - rb) * mult;
          // Secondary: conviction desc so within a tier band the
          // strongest-conviction name surfaces first.
          return b.conviction_score - a.conviction_score;
        }
        case "state": {
          const ra = STATE_RANK[a.ticker_state ?? ""] ?? 0;
          const rb = STATE_RANK[b.ticker_state ?? ""] ?? 0;
          if (ra !== rb) return (ra - rb) * mult;
          // Secondary: conviction desc so within a state group the
          // strongest signals surface first.
          return b.conviction_score - a.conviction_score;
        }
      }
    });
  }, [rows, filter, query, sortKey, sortDir, tierFilter, flagsFilter]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: rows.length,
      unseen: 0,
      in_portfolio: 0,
      watchlist: 0,
      discarded: 0,
    };
    for (const r of rows) {
      if (!r.ticker_state) c.unseen += 1;
      else if (r.ticker_state === "in_portfolio") c.in_portfolio += 1;
      else if (r.ticker_state === "watchlist") c.watchlist += 1;
      else if (r.ticker_state === "discarded") c.discarded += 1;
    }
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                active
                  ? "rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {f.label}
              <span
                className={
                  active
                    ? "ml-1.5 text-navy-200"
                    : "ml-1.5 text-navy-400"
                }
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por ticker o empresa…"
          className="ml-auto w-64 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-navy-500">
          Calidad
        </span>
        {TIER_FILTERS.map((f) => {
          const active = tierFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setTierFilter(f.key)}
              className={
                active
                  ? "rounded-full bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {f.label}
            </button>
          );
        })}
        <span className="ml-4 font-semibold uppercase tracking-wider text-navy-500">
          Red flags
        </span>
        {FLAGS_FILTERS.map((f) => {
          const active = flagsFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFlagsFilter(f.key)}
              className={
                active
                  ? "rounded-full bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-navy-100 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-navy-100 bg-navy-50 text-xs uppercase tracking-wider text-navy-600">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">#</th>
              <SortableHeader
                label="Ticker"
                active={sortKey === "ticker"}
                dir={sortDir}
                onClick={() => handleSort("ticker")}
                align="left"
              />
              <SortableHeader
                label="Empresa"
                active={sortKey === "issuer"}
                dir={sortDir}
                onClick={() => handleSort("issuer")}
                align="left"
              />
              <SortableHeader
                label="Tier"
                active={sortKey === "tier"}
                dir={sortDir}
                onClick={() => handleSort("tier")}
                align="left"
              />
              <th className="px-3 py-3 text-left font-semibold">Flags</th>
              <SortableHeader
                label="Conviction"
                active={sortKey === "conviction"}
                dir={sortDir}
                onClick={() => handleSort("conviction")}
                align="right"
              />
              <SortableHeader
                label="Fondos"
                active={sortKey === "n_funds"}
                dir={sortDir}
                onClick={() => handleSort("n_funds")}
                align="right"
              />
              <th className="px-3 py-3 text-left font-semibold">
                <span className="inline-flex items-center gap-1">
                  Tiers
                  <TiersInfoPopover />
                </span>
              </th>
              <SortableHeader
                label="Estado"
                active={sortKey === "state"}
                dir={sortDir}
                onClick={() => handleSort("state")}
                align="left"
              />
              <th className="px-3 py-3 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-sm text-navy-500"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <LeaderboardTableRow
                key={r.ticker}
                row={r}
                rank={i + 1}
                isExpanded={expanded.has(r.ticker)}
                onToggle={() => toggleExpanded(r.ticker)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaderboardTableRow({
  row,
  rank,
  isExpanded,
  onToggle,
}: {
  row: LeaderboardRow;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const stateStyle = row.ticker_state
    ? STATE_STYLE[row.ticker_state]
    : null;
  const rowClass = row.ticker_state
    ? "border-b border-navy-50 opacity-70 hover:bg-navy-50/40 cursor-pointer"
    : "border-b border-navy-50 hover:bg-navy-50/40 cursor-pointer";

  return (
    <>
      <tr className={rowClass} onClick={onToggle}>
        <td className="px-3 py-3 text-xs text-navy-400">{rank}</td>
        <td className="px-3 py-3">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className={
                isExpanded
                  ? "text-navy-600"
                  : "text-navy-300"
              }
            >
              {isExpanded ? "▾" : "▸"}
            </span>
            <span className="font-mono text-sm font-semibold text-navy-900">
              {row.ticker}
            </span>
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-navy-700">
          {row.issuer_name}
        </td>
        <td className="px-3 py-3">
          <BusinessTierChip
            tier={row.business_tier}
            source={row.business_tier_source}
            notCoveredReason={
              row.pre_analysis_status === "not_covered"
                ? row.pre_analysis_reason
                : null
            }
          />
        </td>
        <td className="px-3 py-3">
          <FlagsBadge
            analyzed={row.business_tier !== null}
            serious={row.serious_flag_count}
            watch={row.watch_flag_count}
          />
        </td>
        <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-navy-900">
          {row.conviction_score.toFixed(1)}
        </td>
        <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-navy-700">
          {row.n_funds}
        </td>
        <td className="px-3 py-3">
          <TierBreakdown row={row} />
        </td>
        <td className="px-3 py-3">
          {stateStyle ? (
            <span
              className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${stateStyle.chip}`}
            >
              {stateStyle.label}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-navy-400">
              Sin analizar
            </span>
          )}
        </td>
        <td
          className="px-3 py-3 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          {row.business_tier !== null ? (
            <ViewFichaLink ticker={row.ticker} />
          ) : (
            <AnalyzeButton ticker={row.ticker} />
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-navy-100 bg-navy-50/40">
          <td colSpan={10} className="px-6 py-4">
            <FundBreakdownGrouped funds={row.fund_breakdown} />
          </td>
        </tr>
      )}
    </>
  );
}

// Grouped fund list — A/B/C/D/E sections, sorted by weight_in_fund
// (biggest conviction first inside each tier). Empty tiers are hidden.
function FundBreakdownGrouped({ funds }: { funds: FundInPosition[] }) {
  const grouped = useMemo(() => {
    const g: Record<string, FundInPosition[]> = {
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
    };
    for (const f of funds) {
      if (g[f.tier]) g[f.tier].push(f);
    }
    for (const t of Object.keys(g)) {
      g[t].sort((a, b) => b.weight_in_fund - a.weight_in_fund);
    }
    return g;
  }, [funds]);

  const tiers = (["A", "B", "C", "D", "E"] as const).filter(
    (t) => grouped[t].length > 0,
  );

  return (
    <div className="space-y-3">
      {tiers.map((t) => (
        <div key={t}>
          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-navy-600">
            <span
              className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_CHIP[t]}`}
            >
              {t}
            </span>
            <span>{TIER_LABEL[t]}</span>
            <span className="text-navy-400">· {grouped[t].length}</span>
          </p>
          <ul className="ml-1 grid grid-cols-1 gap-1 text-xs text-navy-700 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[t].map((f) => (
              <li
                key={f.display_name}
                className="flex items-center justify-between rounded border border-navy-100 bg-white px-2 py-1.5"
              >
                <Link
                  href={`/dashboard/discovery/fund/${f.cik}`}
                  className="truncate text-navy-700 hover:text-navy-900 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {f.display_name}
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
  );
}

// Minimal tier-letter badges showing which tiers hold this ticker. A=3
// quality core, B=2 value, C=1 growth, D=1 concentrated, E=0.5 hedge.
function TierBreakdown({ row }: { row: LeaderboardRow }) {
  const tiers: { key: string; count: number; tone: string }[] = [
    { key: "A", count: row.tier_a_funds, tone: "bg-emerald-100 text-emerald-800" },
    { key: "B", count: row.tier_b_funds, tone: "bg-teal-100 text-teal-800" },
    { key: "C", count: row.tier_c_funds, tone: "bg-navy-100 text-navy-700" },
    { key: "D", count: row.tier_d_funds, tone: "bg-navy-100 text-navy-700" },
    { key: "E", count: row.tier_e_funds, tone: "bg-navy-50 text-navy-500" },
  ];
  return (
    <div className="flex gap-1">
      {tiers.map((t) =>
        t.count > 0 ? (
          <span
            key={t.key}
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.tone}`}
            title={`${t.count} fund(s) in tier ${t.key}`}
          >
            {t.key}·{t.count}
          </span>
        ) : null,
      )}
    </div>
  );
}

// Column header that toggles sort state on click. Indicator glyph
// ↕ (inactive), ▲ (asc), ▼ (desc). Alignment prop mirrors the th so
// numeric columns retain right alignment.
function SortableHeader({
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
  const alignCell = align === "right" ? "text-right" : "text-left";
  const alignFlex = align === "right" ? "justify-end" : "justify-start";
  return (
    <th className={`px-3 py-3 font-semibold ${alignCell}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${alignFlex} ${
          active ? "text-navy-900" : "text-navy-600"
        } hover:text-navy-900`}
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

// Info popover that explains what each tier letter means. Click to
// toggle; click outside dismisses. Kept in-component since the tier
// roster is specific to Discovery — no reason to generalise.
function TiersInfoPopover() {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block normal-case tracking-normal">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Qué significa cada tier"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-navy-300 bg-white text-[10px] font-bold text-navy-500 hover:border-navy-500 hover:text-navy-800"
      >
        i
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-6 z-20 w-80 rounded-xl border border-navy-200 bg-white p-4 text-[11px] leading-relaxed text-navy-700 shadow-lg">
            <p className="mb-2 font-semibold text-navy-900">
              Tipos de fondo por tier
            </p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-semibold text-emerald-800">A · Quality Compounders</span>{" "}
                <span className="text-navy-500">(peso 3.0)</span> — Fundsmith,
                Akre, Polen, Markel, AKO, Lindsell Train, Cantillon, Jensen,
                Giverny, Wedgewood
              </li>
              <li>
                <span className="font-semibold text-teal-800">B · Value</span>{" "}
                <span className="text-navy-500">(peso 2.0)</span> — Berkshire,
                Gates Foundation, Himalaya, Aquamarine, Baupost, TCI, Harris
                Associates
              </li>
              <li>
                <span className="font-semibold text-navy-800">C · Growth / GARP</span>{" "}
                <span className="text-navy-500">(peso 1.0)</span> — Tiger Global,
                Lone Pine, Durable, ShawSpring, Baillie Gifford, Viking,
                Greenlea Lane
              </li>
              <li>
                <span className="font-semibold text-navy-800">D · Concentrated</span>{" "}
                <span className="text-navy-500">(peso 1.0)</span> — Punch Card,
                Conifer, Oakcliff, Brave Warrior, RV Capital
              </li>
              <li>
                <span className="font-semibold text-navy-600">E · Hedge funds</span>{" "}
                <span className="text-navy-500">(peso 0.5)</span> — Greenlight,
                Pershing Square (solo libro largo)
              </li>
            </ul>
            <p className="mt-3 text-[10px] text-navy-500">
              El conviction score suma (peso × weight_in_fund) de cada fondo
              que posee la empresa. Los tier A pesan 6× más que los E.
            </p>
          </div>
        </>
      )}
    </span>
  );
}

// Sends the user to the right ficha for this ticker — position page,
// watchlist page, or back to the wizard — via the universal dispatcher
// at /dashboard/ticker/[symbol]. Used when the ticker has already
// been analyzed (business_tier !== null); the alternative is the
// AnalyzeButton below for first-time discovery.
function ViewFichaLink({ ticker }: { ticker: string }) {
  return (
    <Link
      href={`/dashboard/ticker/${ticker}`}
      prefetch={false}
      className="whitespace-nowrap rounded-lg border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
    >
      Ver →
    </Link>
  );
}

function AnalyzeButton({ ticker }: { ticker: string }) {
  const [isPending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("ticker", ticker);
      await reanalyzeTickerAction(fd);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="whitespace-nowrap rounded-lg border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900 disabled:opacity-50"
    >
      {isPending ? "…" : "Analizar →"}
    </button>
  );
}
