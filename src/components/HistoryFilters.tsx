"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EnrichedTickerState } from "@/lib/tickerStates";
import type { Tier } from "@/lib/verdict";
import { BusinessTierChip } from "@/components/shared/BusinessSignalChips";
import { reanalyzeTickerAction } from "@/app/dashboard/actions";

type FilterTier = "all" | Tier;

const TIER_TABS: Array<{ key: FilterTier; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "exceptional", label: "Exceptional" },
  { key: "good", label: "Good" },
  { key: "mediocre", label: "Mediocre" },
  { key: "poor", label: "Poor" },
];

export default function HistoryFilters({
  discarded,
  companyNames,
  livedPositions,
}: {
  discarded: EnrichedTickerState[];
  companyNames: Record<string, string | null>;
  livedPositions: Record<string, number>;
}) {
  const [tier, setTier] = useState<FilterTier>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<FilterTier, number> = {
      all: discarded.length,
      exceptional: 0,
      good: 0,
      mediocre: 0,
      poor: 0,
    };
    for (const item of discarded) {
      if (item.business_tier !== null) c[item.business_tier] += 1;
    }
    return c;
  }, [discarded]);

  const matches = (item: EnrichedTickerState) => {
    if (tier !== "all" && item.business_tier !== tier) return false;
    const q = query.trim().toUpperCase();
    if (q) {
      const company = companyNames[item.ticker]?.toUpperCase() ?? "";
      if (!item.ticker.includes(q) && !company.includes(q)) return false;
    }
    return true;
  };

  const filtered = discarded.filter(matches);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {TIER_TABS.map((tab) => {
          const active = tier === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTier(tab.key)}
              className={
                active
                  ? "rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
              }
            >
              {tab.label}
              <span
                className={
                  active ? "ml-1.5 text-navy-200" : "ml-1.5 text-navy-400"
                }
              >
                {counts[tab.key]}
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

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-200 bg-navy-50/30 p-8 text-center text-sm text-navy-500">
          Sin resultados para este filtro.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const livedPositionId = livedPositions[item.ticker];
            const wasHeld = livedPositionId !== undefined;
            const company = companyNames[item.ticker];
            return (
              <div
                key={item.id}
                className="rounded-xl border border-navy-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-lg font-semibold text-navy-900">
                          {item.ticker}
                        </span>
                        {company && (
                          <span className="text-sm text-navy-700">
                            {company}
                          </span>
                        )}
                        <BusinessTierChip tier={item.business_tier} />
                        {wasHeld && (
                          <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">
                            Was held
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-navy-500">
                        {formatDate(item.last_touched_at)}
                      </span>
                    </div>
                    {item.reason_md && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-navy-600">
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
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
