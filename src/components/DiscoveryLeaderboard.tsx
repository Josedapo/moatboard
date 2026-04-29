"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { openTickerSubmitAction } from "@/app/dashboard/actions";
import type {
  BusinessTier,
  LeaderboardRow,
  FundInPosition,
} from "@/lib/discoveryLeaderboard";
import {
  BusinessTierChip,
  FlagsBadge,
} from "@/components/shared/BusinessSignalChips";
import WatchlistStarToggle from "@/components/WatchlistStarToggle";

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

// Discovery filter model (post-2026-04-29 redesign):
//   - search: ticker or issuer_name (case-insensitive substring)
//   - onlyWatchlist: boolean toggle
//   - tierSet: multi-select over BusinessTier; empty = pass all
//   - flagsFilter: tri-state (all / no_serious / with_serious)
//   - convictionMin / nFundsMin: numeric "≥ N" filters; null = no filter
//
// AND between groups, OR within multi-select tier chips. Untiered rows
// (business_tier === null) pass when no tier or flags filter is active
// and fail when one is — we cannot evaluate the gate against missing data.

const TIER_OPTIONS: { key: BusinessTier; label: string }[] = [
  { key: "exceptional", label: "Exceptional" },
  { key: "good", label: "Good" },
  { key: "mediocre", label: "Mediocre" },
  { key: "poor", label: "Poor" },
];

type FlagsFilterKey = "all" | "no_serious" | "with_serious";

const FLAGS_FILTERS: { key: FlagsFilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "no_serious", label: "Sin graves" },
  { key: "with_serious", label: "Con graves" },
];


type SortKey =
  | "ticker"
  | "issuer"
  | "tier"
  | "conviction"
  | "n_funds";
type SortDir = "asc" | "desc";

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
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [tierSet, setTierSet] = useState<Set<BusinessTier>>(new Set());
  const [flagsFilter, setFlagsFilter] = useState<FlagsFilterKey>("all");
  const [convictionMin, setConvictionMin] = useState<number | null>(null);
  const [nFundsMin, setNFundsMin] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("conviction");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleTier = (tier: BusinessTier) => {
    setTierSet((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  const clearAll = () => {
    setOnlyWatchlist(false);
    setTierSet(new Set());
    setFlagsFilter("all");
    setConvictionMin(null);
    setNFundsMin(null);
    setQuery("");
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Sensible defaults: numeric columns desc, text columns asc.
      setSortDir(
        key === "ticker" || key === "issuer" ? "asc" : "desc",
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
      // Search — ticker OR issuer name, case-insensitive substring.
      if (q && !r.ticker.includes(q) && !r.issuer_name.toUpperCase().includes(q))
        return false;

      // Watchlist toggle.
      if (onlyWatchlist && r.ticker_state !== "watchlist") return false;

      // Tier multi-select. Empty set = pass all (including untiered).
      // Any tier picked = untiered rows fail (can't evaluate the gate).
      if (tierSet.size > 0) {
        if (r.business_tier === null) return false;
        if (!tierSet.has(r.business_tier)) return false;
      }

      // Flags tri-state. Untiered rows pass when "all", fail otherwise
      // — we can't evaluate flags we haven't computed.
      if (flagsFilter !== "all") {
        if (r.business_tier === null) return false;
        if (flagsFilter === "no_serious" && r.serious_flag_count > 0)
          return false;
        if (flagsFilter === "with_serious" && r.serious_flag_count === 0)
          return false;
      }

      // Numeric mins (≥). Conviction/n_funds are always non-null on
      // every row, so no special-case for missing data.
      if (convictionMin !== null && r.conviction_score < convictionMin)
        return false;
      if (nFundsMin !== null && r.n_funds < nFundsMin) return false;

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
      }
    });
  }, [
    rows,
    query,
    onlyWatchlist,
    tierSet,
    flagsFilter,
    convictionMin,
    nFundsMin,
    sortKey,
    sortDir,
  ]);

  const watchlistCount = useMemo(
    () => rows.filter((r) => r.ticker_state === "watchlist").length,
    [rows],
  );

  const activeFilterCount =
    (onlyWatchlist ? 1 : 0) +
    (tierSet.size > 0 ? 1 : 0) +
    (flagsFilter !== "all" ? 1 : 0) +
    (convictionMin !== null ? 1 : 0) +
    (nFundsMin !== null ? 1 : 0) +
    (query.trim() !== "" ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Row 1 — search + summary */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por ticker o nombre…"
          className="w-72 rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-navy-500">
          <span className="tabular-nums">
            Mostrando {filtered.length} de {rows.length}
          </span>
          {activeFilterCount > 0 && (
            <>
              <span className="text-navy-300">·</span>
              <button
                type="button"
                onClick={clearAll}
                className="font-medium text-navy-700 underline-offset-2 hover:underline"
              >
                Limpiar filtros ({activeFilterCount})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Row 2 — criteria groups */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <button
          type="button"
          onClick={() => setOnlyWatchlist((v) => !v)}
          aria-pressed={onlyWatchlist}
          className={
            onlyWatchlist
              ? "rounded-full bg-navy-900 px-3 py-1 font-semibold text-white"
              : "rounded-full border border-navy-200 bg-white px-3 py-1 font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
          }
        >
          ★ Solo watchlist
          <span
            className={
              onlyWatchlist ? "ml-1.5 text-navy-200" : "ml-1.5 text-navy-400"
            }
          >
            {watchlistCount}
          </span>
        </button>

        <span className="text-navy-300">·</span>

        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
          Calidad
        </span>
        {TIER_OPTIONS.map((t) => {
          const active = tierSet.has(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => toggleTier(t.key)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full bg-navy-900 px-2.5 py-1 font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-2.5 py-1 font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {t.label}
            </button>
          );
        })}

        <span className="text-navy-300">·</span>

        <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
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
                  ? "rounded-full bg-navy-900 px-2.5 py-1 font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-2.5 py-1 font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Row 3 — numeric mins (separate line so categorical chips above stay on one line) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 text-navy-600">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Conviction ≥
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={convictionMin ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setConvictionMin(v === "" ? null : Number(v));
            }}
            className="w-16 rounded-lg border border-navy-200 bg-white px-2 py-1 text-xs tabular-nums text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
            placeholder="—"
          />
        </label>

        <label className="flex items-center gap-1.5 text-navy-600">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Fondos ≥
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={nFundsMin ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setNFundsMin(v === "" ? null : Number(v));
            }}
            className="w-14 rounded-lg border border-navy-200 bg-white px-2 py-1 text-xs tabular-nums text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
            placeholder="—"
          />
        </label>
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
              <th className="px-3 py-3 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-navy-500"
                >
                  <EmptyState query={query} />
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
  return (
    <>
      <tr
        className="border-b border-navy-50 hover:bg-navy-50/40 cursor-pointer"
        onClick={onToggle}
      >
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
            <span onClick={(e) => e.stopPropagation()}>
              <WatchlistStarToggle
                ticker={row.ticker}
                isOnWatchlist={row.ticker_state === "watchlist"}
                size="sm"
              />
            </span>
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-navy-700">
          {row.issuer_name}
        </td>
        <td className="px-3 py-3">
          <BusinessTierChip
            tier={row.business_tier}
            notCoveredReason={row.not_covered_reason}
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
        <td
          className="px-3 py-3 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <ViewFichaLink ticker={row.ticker} />
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-navy-100 bg-navy-50/40">
          <td colSpan={9} className="px-6 py-4">
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

// Universal entry to a ticker's ficha — used regardless of whether the
// company has been analyzed. The ficha is the canonical surface; from
// there the user opts in to the wizard via "Empezar análisis" /
// "Re-analizar" on the Decisión tab.
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

// Empty-state helper. When the search query looks like a ticker but
// nothing in the leaderboard matches, offer to open the ticker directly
// — same behaviour as the (now-retired) top-of-page entry form. The
// validation regex mirrors openTickerAction's server-side guard so we
// don't surface the CTA for queries that would only be rejected.
const TICKER_FORMAT = /^[A-Za-z./-]{1,10}$/;

function EmptyState({ query }: { query: string }) {
  const trimmed = query.trim();
  const looksLikeTicker = trimmed !== "" && TICKER_FORMAT.test(trimmed);
  if (!looksLikeTicker) {
    return <span className="italic">Sin resultados.</span>;
  }
  const upper = trimmed.replace(/[./]/g, "-").toUpperCase();
  return (
    <form
      action={openTickerSubmitAction}
      className="flex flex-col items-center gap-3"
    >
      <input type="hidden" name="ticker" value={upper} />
      <span className="italic">
        Ningún negocio del leaderboard coincide con &ldquo;{trimmed}&rdquo;.
      </span>
      <button
        type="submit"
        className="rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
      >
        Abrir ficha de {upper} →
      </button>
    </form>
  );
}
