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
            Intrinsic value estimate vs current market price for {ticker}.
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
              {isPending ? "Regenerating..." : "Regenerate with AI"}
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
  const current = Number(valuation.current_price);
  // Recompute live so legacy rows / formula changes always render correctly
  const { mosPct, ivPriceRatio, tier } = classifyMarginOfSafety(intrinsic, current);
  const isAboveIntrinsic = mosPct < 0;

  const headlinePhrase = isAboveIntrinsic
    ? `Price ${Math.abs(mosPct).toFixed(1)}% above intrinsic`
    : `Margin of Safety: ${mosPct.toFixed(1)}%`;

  const headlineColor = mosHeadlineColor(tier);

  const methodLabel =
    valuation.method === "dcf"
      ? "DCF (10-year discounted cash flow)"
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

function DcfDetails({
  positionId,
  assumptions,
}: {
  positionId: number;
  assumptions: DcfStoredAssumptions;
}) {
  const [editing, setEditing] = useState(false);
  const [growthRate, setGrowthRate] = useState(
    (assumptions.growth_rate * 100).toFixed(1),
  );
  const [terminalGrowth, setTerminalGrowth] = useState(
    (assumptions.terminal_growth * 100).toFixed(1),
  );
  const [discountRate, setDiscountRate] = useState(
    (assumptions.discount_rate * 100).toFixed(1),
  );
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const g = Number(growthRate) / 100;
    const t = Number(terminalGrowth) / 100;
    const d = Number(discountRate) / 100;
    if (!Number.isFinite(g) || !Number.isFinite(t) || !Number.isFinite(d)) {
      setError("All values must be numeric");
      return;
    }
    if (d <= t) {
      setError("Discount rate must be greater than terminal growth");
      return;
    }
    startSaving(async () => {
      try {
        await updateValuationAssumptionsAction({
          positionId,
          growthRate: g,
          terminalGrowth: t,
          discountRate: d,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      }
    });
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-navy-100">
          <Row label="FCF base (TTM)" value={formatLargeUSD(assumptions.fcf_base)} />
          <Row
            label="Growth rate (years 1-10)"
            value={
              editing ? (
                <PctInput value={growthRate} onChange={setGrowthRate} />
              ) : (
                `${(assumptions.growth_rate * 100).toFixed(1)}%`
              )
            }
          />
          <Row
            label="Terminal growth"
            value={
              editing ? (
                <PctInput value={terminalGrowth} onChange={setTerminalGrowth} />
              ) : (
                `${(assumptions.terminal_growth * 100).toFixed(1)}%`
              )
            }
          />
          <Row
            label="Discount rate (WACC)"
            value={
              editing ? (
                <PctInput value={discountRate} onChange={setDiscountRate} />
              ) : (
                `${(assumptions.discount_rate * 100).toFixed(1)}%`
              )
            }
          />
          <Row label="Net debt" value={formatLargeUSD(assumptions.net_debt)} />
          <Row
            label="Shares outstanding"
            value={formatShares(assumptions.shares_outstanding)}
          />
        </tbody>
      </table>

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
                setGrowthRate((assumptions.growth_rate * 100).toFixed(1));
                setTerminalGrowth((assumptions.terminal_growth * 100).toFixed(1));
                setDiscountRate((assumptions.discount_rate * 100).toFixed(1));
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
            Edit assumptions
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <td className="py-2 text-navy-500">{label}</td>
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
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="px-1 sm:first:pl-0 sm:px-5 sm:last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor ?? ""}`}>
        {value}
      </div>
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
