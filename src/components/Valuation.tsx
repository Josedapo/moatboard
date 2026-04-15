"use client";

import { useState, useTransition } from "react";
import type {
  Valuation,
  DcfStoredAssumptions,
  AiMultiplesStoredAssumptions,
} from "@/lib/valuations";
import { classifyMarginOfSafety, type MosTier } from "@/lib/valuation";
import type { Fundamentals } from "@/lib/financial";
import {
  runValuationAction,
  updateValuationAssumptionsAction,
} from "@/app/dashboard/position/[id]/actions";
import MarginOfSafetyBadge from "@/components/MarginOfSafetyBadge";
import ScorecardCard from "@/components/ScorecardCard";
import { scoreMetric } from "@/lib/scorecard";

export default function ValuationSection({
  positionId,
  ticker,
  valuation,
  fundamentals,
  loadError,
}: {
  positionId: number;
  ticker: string;
  valuation: Valuation | null;
  fundamentals: Fundamentals | null;
  loadError?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(loadError ?? null);

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      try {
        await runValuationAction(positionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to regenerate");
      }
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-950">Valuation</h2>
          <p className="mt-1 text-xs text-navy-500">
            Intrinsic value range vs current market price for {ticker}. Owner
            earnings two-stage DCF across 10%, 12% and 14% hurdle rates.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {valuation && (
            <MarginOfSafetyBadge
              tier={
                classifyMarginOfSafety(
                  Number(valuation.intrinsic_value),
                  Number(valuation.current_price),
                ).tier
              }
              size="lg"
            />
          )}
          {valuation && (
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

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Market multiples — always visible (observable data, no AI needed) */}
      {fundamentals && (
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
            Market Multiples
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ScorecardCard
              label="Trailing P/E"
              hint="Last 12 months"
              value={formatNumber(fundamentals.trailingPE)}
              quality={scoreMetric("trailingPE", fundamentals.trailingPE)}
            />
            <ScorecardCard
              label="Forward P/E"
              hint="Next 12 months"
              value={formatNumber(fundamentals.forwardPE)}
              quality={scoreMetric("forwardPE", fundamentals.forwardPE)}
            />
          </div>
        </div>
      )}

      {valuation ? (
        <ValuationView positionId={positionId} valuation={valuation} />
      ) : (
        <p className="text-sm text-navy-500">
          {loadError
            ? "Could not compute the intrinsic value automatically. Try Regenerate above."
            : "Intrinsic value estimate is not available — usually because current market price could not be fetched."}
        </p>
      )}
    </section>
  );
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function ValuationView({
  positionId,
  valuation,
}: {
  positionId: number;
  valuation: Valuation;
}) {
  const intrinsic = Number(valuation.intrinsic_value);
  const intrinsicLow = Number(valuation.intrinsic_value_low);
  const intrinsicHigh = Number(valuation.intrinsic_value_high);
  const current = Number(valuation.current_price);
  const { mosPct, ivPriceRatio, tier } = classifyMarginOfSafety(
    intrinsic,
    current,
  );
  const isAboveIntrinsic = mosPct < 0;

  const headlinePhrase = isAboveIntrinsic
    ? `Price ${Math.abs(mosPct).toFixed(1)}% above intrinsic (base case)`
    : `Margin of Safety: ${mosPct.toFixed(1)}% (base case)`;

  const headlineColor = mosHeadlineColor(tier);
  const hasRange = valuation.method === "dcf" && intrinsicLow !== intrinsicHigh;

  const methodLabel =
    valuation.method === "dcf"
      ? "Owner earnings two-stage DCF"
      : "AI multiples (DCF not applicable)";

  return (
    <div>
      <div
        className={`mb-4 rounded-lg border p-5 ${valuationBoxStyles(tier)}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-70">
            {methodLabel}
          </div>
          <div className={`text-lg font-bold ${headlineColor}`}>
            {headlinePhrase}
          </div>
        </div>

        {hasRange ? (
          <ValuationRangeBar
            bear={intrinsicLow}
            base={intrinsic}
            bull={intrinsicHigh}
            price={current}
            ivPriceRatio={ivPriceRatio}
          />
        ) : (
          <div className={`mt-5 grid gap-4 sm:grid-cols-3 ${statDividerStyles(tier)}`}>
            <Stat
              label="Intrinsic value"
              value={`$${intrinsic.toFixed(2)}`}
            />
            <Stat
              label="Current price"
              value={`$${current.toFixed(2)}`}
            />
            <Stat
              label="IV / Price"
              value={`${ivPriceRatio.toFixed(2)}x`}
              valueColor={headlineColor}
            />
          </div>
        )}

        <p className="mt-5 text-sm leading-relaxed border-t border-current/10 pt-4">
          {valuation.reasoning}
        </p>
      </div>

      <details className="mb-2 rounded-lg border border-navy-100 bg-navy-50/30 p-4">
        <summary className="cursor-pointer text-sm font-medium text-navy-700 hover:text-navy-900">
          How we calculated this
        </summary>
        <div className="mt-4">
          {valuation.method === "dcf" ? (
            <DcfDetails
              positionId={positionId}
              assumptions={valuation.assumptions as DcfStoredAssumptions}
              intrinsicBase={intrinsic}
              intrinsicLow={intrinsicLow}
              intrinsicHigh={intrinsicHigh}
            />
          ) : (
            <MultiplesDetails
              assumptions={valuation.assumptions as AiMultiplesStoredAssumptions}
            />
          )}
        </div>
      </details>
    </div>
  );
}

// Visualizes the IV range (bear → base → bull) with the current price marked
// on top. The bar itself represents the spectrum of possible intrinsic values
// across the three hurdle rates; where the price sits relative to that range
// tells you how robust the margin-of-safety call is.
function ValuationRangeBar({
  bear,
  base,
  bull,
  price,
  ivPriceRatio,
}: {
  bear: number;
  base: number;
  bull: number;
  price: number;
  ivPriceRatio: number;
}) {
  // Widen the visual scale so the price, if outside the range, still lands
  // somewhere sensible without hugging the edge. Scale covers 10% beyond
  // each end of the IV range OR the price, whichever is wider.
  const rangeSpan = Math.max(bull - bear, bull * 0.01);
  const scaleMin = Math.min(bear, price) - rangeSpan * 0.1;
  const scaleMax = Math.max(bull, price) + rangeSpan * 0.1;
  const scaleSpan = scaleMax - scaleMin;

  const pct = (v: number) => ((v - scaleMin) / scaleSpan) * 100;
  const bearPct = pct(bear);
  const basePct = pct(base);
  const bullPct = pct(bull);
  const pricePct = Math.max(0, Math.min(100, pct(price)));

  const status = (() => {
    if (price < bear) {
      return {
        label: "Below bear-case IV — margin of safety in every scenario",
        color: "text-emerald-700",
        dot: "bg-emerald-500",
      };
    }
    if (price > bull) {
      return {
        label: "Above bull-case IV — overvalued even on optimistic assumptions",
        color: "text-red-700",
        dot: "bg-red-500",
      };
    }
    if (price < base) {
      return {
        label: "Within the valuation range — margin of safety under the base case",
        color: "text-teal-700",
        dot: "bg-teal-500",
      };
    }
    return {
      label: "Within the valuation range — above the base case",
      color: "text-amber-700",
      dot: "bg-amber-500",
    };
  })();

  return (
    <div className="mt-6">
      {/* Numbers row above the bar */}
      <div className="relative h-5 text-[11px] font-semibold tabular-nums">
        <span
          className="absolute -translate-x-1/2 text-navy-600"
          style={{ left: `${bearPct}%` }}
        >
          ${bear.toFixed(2)}
        </span>
        <span
          className="absolute -translate-x-1/2 text-navy-900"
          style={{ left: `${basePct}%` }}
        >
          ${base.toFixed(2)}
        </span>
        <span
          className="absolute -translate-x-1/2 text-navy-600"
          style={{ left: `${bullPct}%` }}
        >
          ${bull.toFixed(2)}
        </span>
      </div>

      {/* Main bar */}
      <div className="relative h-9">
        {/* Background track across entire scale */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-current/10" />
        {/* Active range: bear to bull */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-current/40"
          style={{ left: `${bearPct}%`, width: `${bullPct - bearPct}%` }}
        />
        {/* Base tick */}
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-current/70"
          style={{ left: `${basePct}%` }}
          aria-label="base case"
        />

        {/* Price marker */}
        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${pricePct}%` }}
        >
          <div className={`mx-auto h-4 w-4 rotate-45 rounded-sm border-2 border-white shadow ${status.dot}`} />
          <div className="mt-0.5 whitespace-nowrap text-[10px] font-semibold text-navy-900">
            Price ${price.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Legend row under the bar */}
      <div className="relative mt-1 h-4 text-[10px] font-medium uppercase tracking-wider">
        <span
          className="absolute -translate-x-1/2 opacity-60"
          style={{ left: `${bearPct}%` }}
        >
          Bear
        </span>
        <span
          className="absolute -translate-x-1/2 opacity-80"
          style={{ left: `${basePct}%` }}
        >
          Base
        </span>
        <span
          className="absolute -translate-x-1/2 opacity-60"
          style={{ left: `${bullPct}%` }}
        >
          Bull
        </span>
      </div>

      {/* Status line */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-3">
        <div className={`flex items-center gap-2 text-xs font-medium ${status.color}`}>
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          {status.label}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wider opacity-70">
          IV / Price <span className="tabular-nums">{ivPriceRatio.toFixed(2)}x</span>
        </div>
      </div>
    </div>
  );
}

function DcfDetails({
  positionId,
  assumptions,
  intrinsicBase,
  intrinsicLow,
  intrinsicHigh,
}: {
  positionId: number;
  assumptions: DcfStoredAssumptions;
  intrinsicBase: number;
  intrinsicLow: number;
  intrinsicHigh: number;
}) {
  const [editing, setEditing] = useState(false);
  const [stageOneGrowth, setStageOneGrowth] = useState(
    (assumptions.stage_one_growth * 100).toFixed(1),
  );
  const [terminalGrowth, setTerminalGrowth] = useState(
    (assumptions.terminal_growth * 100).toFixed(1),
  );
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const g = Number(stageOneGrowth) / 100;
    const t = Number(terminalGrowth) / 100;
    if (!Number.isFinite(g) || !Number.isFinite(t)) {
      setError("All values must be numeric");
      return;
    }
    startSaving(async () => {
      try {
        await updateValuationAssumptionsAction({
          positionId,
          stageOneGrowth: g,
          terminalGrowth: t,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      }
    });
  }

  const terminalSource =
    assumptions.treasury_source === "yfinance_tnx"
      ? "5y avg US 10y Treasury yield"
      : "fallback (Treasury fetch failed)";

  return (
    <div className="space-y-5">
      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Owner earnings (base year)
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row label="Net income" value={formatLargeUSD(assumptions.net_income)} />
            <Row
              label="+ Depreciation & amortization"
              value={formatLargeUSD(assumptions.depreciation_amortization)}
            />
            <Row
              label={`− Maintenance capex proxy (${assumptions.years_of_history || 0}y avg)`}
              value={formatLargeUSD(assumptions.maintenance_capex_proxy)}
            />
            <Row
              label="= Owner earnings"
              value={
                <span className="font-semibold">
                  {formatLargeUSD(assumptions.owner_earnings_base)}
                </span>
              }
            />
          </tbody>
        </table>
        {assumptions.base_note && (
          <p className="mt-1 text-[11px] text-amber-700">{assumptions.base_note}</p>
        )}
      </div>

      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Growth assumptions
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row
              label="Stage 1 growth (years 1–5)"
              value={
                editing ? (
                  <PctInput value={stageOneGrowth} onChange={setStageOneGrowth} />
                ) : (
                  `${(assumptions.stage_one_growth * 100).toFixed(1)}%`
                )
              }
            />
            <Row
              label="Terminal growth (year 10+)"
              value={
                editing ? (
                  <PctInput value={terminalGrowth} onChange={setTerminalGrowth} />
                ) : (
                  `${(assumptions.terminal_growth * 100).toFixed(1)}%`
                )
              }
              sub={`Anchor: ${terminalSource}`}
            />
            <Row
              label="Stage 2 (years 6–10)"
              value={<span className="text-navy-500">Geometric fade</span>}
            />
          </tbody>
        </table>
      </div>

      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Hurdle rates & intrinsic value range
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row
              label={`Bull (${(assumptions.hurdle_rates.high * 100).toFixed(0)}% hurdle)`}
              value={`$${intrinsicHigh.toFixed(2)}`}
            />
            <Row
              label={`Base (${(assumptions.hurdle_rates.base * 100).toFixed(0)}% hurdle)`}
              value={
                <span className="font-semibold">
                  ${intrinsicBase.toFixed(2)}
                </span>
              }
            />
            <Row
              label={`Bear (${(assumptions.hurdle_rates.low * 100).toFixed(0)}% hurdle)`}
              value={`$${intrinsicLow.toFixed(2)}`}
            />
          </tbody>
        </table>
      </div>

      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Other inputs
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row label="Net debt" value={formatLargeUSD(assumptions.net_debt)} />
            <Row
              label="Shares outstanding"
              value={formatShares(assumptions.shares_outstanding)}
            />
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>
      )}

      <div className="flex items-center gap-3">
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {saving ? "Recomputing..." : "Save and recompute"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setStageOneGrowth((assumptions.stage_one_growth * 100).toFixed(1));
                setTerminalGrowth((assumptions.terminal_growth * 100).toFixed(1));
              }}
              disabled={saving}
              className="text-xs text-navy-600 hover:text-navy-900"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-navy-600 hover:text-navy-900"
          >
            Edit growth assumptions
          </button>
        )}
      </div>
    </div>
  );
}

function MultiplesDetails({
  assumptions,
}: {
  assumptions: AiMultiplesStoredAssumptions;
}) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-navy-100">
        <Row label="Method" value="AI multiples (DCF not applicable)" />
        <Row label="Basis" value={assumptions.basis.replace("_", " ")} />
        <Row
          label="Sector multiple used"
          value={assumptions.sector_multiple_used.toFixed(2)}
        />
      </tbody>
    </table>
  );
}

function Row({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <tr>
      <td className="py-2 text-navy-500">
        {label}
        {sub && <div className="text-[10px] text-navy-400">{sub}</div>}
      </td>
      <td className="py-2 text-right font-medium text-navy-900">{value}</td>
    </tr>
  );
}

function PctInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded border border-navy-300 px-2 py-1 text-right text-sm focus:border-navy-900 focus:outline-none"
      />
      <span className="text-navy-500">%</span>
    </span>
  );
}

function valuationBoxStyles(tier: MosTier): string {
  switch (tier) {
    case "margin":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "acceptable":
      return "border-teal-200 bg-teal-50 text-teal-900";
    case "fair":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "premium":
      return "border-red-200 bg-red-50 text-red-900";
  }
}

function statDividerStyles(tier: MosTier): string {
  switch (tier) {
    case "margin":
      return "sm:divide-x sm:divide-emerald-200/70";
    case "acceptable":
      return "sm:divide-x sm:divide-teal-200/70";
    case "fair":
      return "sm:divide-x sm:divide-blue-200/70";
    case "premium":
      return "sm:divide-x sm:divide-red-200/70";
  }
}

function Stat({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <div className="px-1 sm:first:pl-0 sm:px-5 sm:last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor ?? ""}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] font-medium opacity-70">{sub}</div>
      )}
    </div>
  );
}

function mosHeadlineColor(tier: MosTier): string {
  switch (tier) {
    case "margin":
      return "text-emerald-700";
    case "acceptable":
      return "text-teal-700";
    case "fair":
      return "text-blue-700";
    case "premium":
      return "text-red-700";
  }
}

function formatLargeUSD(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(0)}`;
}

function formatShares(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toFixed(0);
}
