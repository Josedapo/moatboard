"use client";

import { useState, useTransition } from "react";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type { Fundamentals } from "@/lib/financial";
import type { Tier, MoatArchetype, MoatStrength } from "@/lib/verdict";
import { runAnalysisAction } from "@/app/dashboard/position/[id]/actions";
import { scoreMetric } from "@/lib/scorecard";
import QualityBadge from "@/components/QualityBadge";
import ScorecardCard from "@/components/ScorecardCard";

const ARCHETYPE_LABELS: Record<MoatArchetype, string> = {
  brand: "Brand",
  network_effects: "Network effects",
  switching_costs: "Switching costs",
  scale: "Scale",
  ip: "Intellectual property",
  regulatory: "Regulatory",
  cost_advantage: "Cost advantage",
  none: "None",
};

const STRENGTH_LABELS: Record<MoatStrength, string> = {
  strong: "Strong",
  weak: "Weak",
  unclear: "Unclear",
};

export default function MoatboardAnalysis({
  positionId,
  ticker,
  analysis,
  fundamentals,
  loadError,
}: {
  positionId: number;
  ticker: string;
  analysis: Analysis | null;
  fundamentals: Fundamentals | null;
  loadError?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(loadError ?? null);

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      try {
        await runAnalysisAction(positionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to regenerate");
      }
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-950">
            Moatboard Business Analysis
          </h2>
          <p className="mt-1 text-xs text-navy-500">
            Quality assessment of {ticker} as a business — moat, profitability,
            cash, balance sheet.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {analysis && <QualityBadge tier={analysis.tier} size="lg" />}
          {analysis && (
            <button
              onClick={handleRegenerate}
              disabled={isPending}
              className="text-sm font-medium text-navy-600 hover:text-navy-900 disabled:opacity-50"
            >
              {isPending ? "Regenerating..." : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {analysis && (
        <div
          className={`mb-6 rounded-lg border p-4 ${verdictBoxStyles(analysis.tier)}`}
        >
          <p className="text-sm leading-relaxed">{analysis.verdict_reason}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
            <span>
              <span className="font-semibold uppercase tracking-wider">Moat:</span>{" "}
              {ARCHETYPE_LABELS[analysis.moat_archetype]} ({STRENGTH_LABELS[analysis.moat_strength]})
            </span>
            <span>·</span>
            <span>Generated {formatDate(analysis.generated_at)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Quality Scorecard (always visible — it's the data behind the verdict) */}
      {fundamentals ? (
        <div>
          <h3 className="mb-4 text-base font-bold text-navy-900">
            Quality Scorecard
          </h3>
          <div className="space-y-5">
            <ScorecardGroup title="Profitability">
              <ScorecardCard
                label="ROE"
                hint="Return on Equity"
                value={formatPct(fundamentals.returnOnEquity)}
                quality={scoreMetric("returnOnEquity", fundamentals.returnOnEquity)}
              />
              <ScorecardCard
                label="ROA"
                hint="Return on Assets"
                value={formatPct(fundamentals.returnOnAssets)}
                quality={scoreMetric("returnOnAssets", fundamentals.returnOnAssets)}
              />
              <ScorecardCard
                label="Gross Margin"
                value={formatPct(fundamentals.grossMargins)}
                quality={scoreMetric("grossMargins", fundamentals.grossMargins)}
              />
              <ScorecardCard
                label="Operating Margin"
                value={formatPct(fundamentals.operatingMargins)}
                quality={scoreMetric("operatingMargins", fundamentals.operatingMargins)}
              />
              <ScorecardCard
                label="Profit Margin"
                value={formatPct(fundamentals.profitMargins)}
                quality={scoreMetric("profitMargins", fundamentals.profitMargins)}
              />
            </ScorecardGroup>

            <ScorecardGroup title="Cash & Balance Sheet">
              <ScorecardCard
                label="Free Cash Flow"
                hint="Last 12 months"
                value={formatLargeUSD(fundamentals.freeCashflow)}
                quality={scoreMetric("freeCashflow", fundamentals.freeCashflow)}
              />
              <ScorecardCard
                label="Debt / Equity"
                hint="% of equity"
                value={formatNumber(fundamentals.debtToEquity)}
                quality={scoreMetric("debtToEquity", fundamentals.debtToEquity)}
              />
              <ScorecardCard
                label="Current Ratio"
                hint="Short-term liquidity"
                value={formatNumber(fundamentals.currentRatio)}
                quality={scoreMetric("currentRatio", fundamentals.currentRatio)}
              />
            </ScorecardGroup>

            <ScorecardGroup title="Growth">
              <ScorecardCard
                label="Revenue Growth"
                hint="Year over year"
                value={formatPct(fundamentals.revenueGrowth)}
                quality={scoreMetric("revenueGrowth", fundamentals.revenueGrowth)}
              />
              <ScorecardCard
                label="Earnings Growth"
                hint="Year over year"
                value={formatPct(fundamentals.earningsGrowth)}
                quality={scoreMetric("earningsGrowth", fundamentals.earningsGrowth)}
              />
            </ScorecardGroup>
          </div>
        </div>
      ) : (
        <p className="text-sm text-navy-500">
          Could not fetch fundamentals for {ticker}.
        </p>
      )}
    </section>
  );
}

function verdictBoxStyles(tier: Tier): string {
  switch (tier) {
    case "exceptional":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "good":
      return "border-teal-200 bg-teal-50 text-teal-900";
    case "average":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "poor":
      return "border-red-200 bg-red-50 text-red-900";
  }
}

function ScorecardGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
        {title}
      </h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatLargeUSD(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(0)}`;
}
