"use client";

// Valuation section — post-redesign (2026-04-16 session).
//
// Philosophy: Munger's "latticework of mental models, plural". Moatboard
// does NOT issue a compound valuation verdict. It shows four independent
// valuation tools — DCF range, PE-vs-own-history, P/FCF-vs-own-history,
// FCF yield vs risk-free — and lets the user weigh them by business type,
// horizon, and conviction. No red/green semantics in the valuation block;
// those would impose a single ponderación the user has not asked for.
// The Quality Scorecard (separate section) keeps its tier color, because
// business quality is defensibly binarizable the way Buffett labels
// businesses ("wonderful / good / fair / mediocre / gruesome").

import { useState, useTransition } from "react";
import type {
  Valuation,
  ValuationMethod,
  DcfStoredAssumptions,
  AiMultiplesStoredAssumptions,
  ExcessReturnsStoredAssumptions,
  RelativeMetricSnapshot,
  RelativeValuationSnapshot,
} from "@/lib/valuations";
import type { ValuationGuide } from "@/lib/valuationGuides";
import type { ToolId } from "@/lib/valuationGuideAi";
import { MOS_TIER_LABELS, type DcfTier } from "@/lib/valuation";
import {
  runValuationAction,
  updateValuationAssumptionsAction,
} from "@/app/dashboard/position/[id]/actions";

export default function ValuationSection({
  positionId,
  valuation,
  guide,
  loadError,
  hideRegenerate = false,
}: {
  positionId: number;
  valuation: Valuation | null;
  guide: ValuationGuide | null;
  loadError?: string | null;
  // Set true inside the analysis wizard — see MoatboardAnalysis.tsx for
  // rationale. Regeneration comes back on the live position page.
  hideRegenerate?: boolean;
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
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-950">Valuation</h2>
          <p className="mt-1 text-xs text-navy-500">
            Four independent tools. No single verdict — weigh them by the
            kind of business and your own judgment.
          </p>
        </div>
        {valuation && !hideRegenerate && (
          <button
            onClick={handleRegenerate}
            disabled={isPending}
            className="text-sm font-medium text-navy-600 hover:text-navy-900 disabled:opacity-50"
          >
            {isPending ? "Regenerating..." : "Regenerate"}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {valuation ? (
        <ValuationToolkit
          positionId={positionId}
          valuation={valuation}
          guide={guide}
        />
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

// Canonical render order across visible + hidden sections.
const TOOL_RENDER_ORDER: ToolId[] = ["dcf", "pe", "pfcf", "pb"];
const RELATIVE_TOOLS: ReadonlySet<ToolId> = new Set(["pe", "pfcf", "pb"]);

function getRecommendedTools(guide: ValuationGuide | null): Set<ToolId> {
  // No guide → fall back to surfacing every renderable tool. Rare but keeps
  // the UI honest when the cache row is missing.
  if (!guide) return new Set(TOOL_RENDER_ORDER);
  const tools = new Set<ToolId>();
  tools.add(guide.primary_tool);
  if (guide.secondary_tool) tools.add(guide.secondary_tool);
  return tools;
}

function ValuationToolkit({
  positionId,
  valuation,
  guide,
}: {
  positionId: number;
  valuation: Valuation;
  guide: ValuationGuide | null;
}) {
  // Extract what each tool needs from the persisted valuation row. All
  // figures are pre-computed server-side; nothing here classifies or judges.
  const intrinsicBase = Number(valuation.intrinsic_value);
  const intrinsicLow = Number(valuation.intrinsic_value_low);
  const intrinsicHigh = Number(valuation.intrinsic_value_high);
  const currentPrice = Number(valuation.current_price);

  const assumptionsAny = valuation.assumptions as {
    relative_valuation?: RelativeValuationSnapshot;
    treasury_current_pct?: number;
    risk_free_rate?: number;
  };
  const relativeSnapshot = assumptionsAny.relative_valuation ?? null;
  // Current spot 10y Treasury yield, from whichever persisted field the
  // valuation method uses. DCF / AFFO persist `treasury_current_pct`,
  // Excess Returns persists `risk_free_rate`. AI multiples does not carry
  // a rate so the V2c cross-check is skipped for that method.
  const treasuryCurrent =
    assumptionsAny.treasury_current_pct ?? assumptionsAny.risk_free_rate ?? null;

  const recommendedTools = getRecommendedTools(guide);

  // Build every renderable tool node up front, keyed by ToolId. A null entry
  // means the tool can't be rendered (no data) and is silently dropped.
  const toolNodes: Partial<Record<ToolId, React.ReactNode>> = {
    dcf: (
      <DcfTool
        positionId={positionId}
        valuation={valuation}
        intrinsicBase={intrinsicBase}
        intrinsicLow={intrinsicLow}
        intrinsicHigh={intrinsicHigh}
        currentPrice={currentPrice}
      />
    ),
  };
  if (relativeSnapshot) {
    const subtitle = `${formatYears(relativeSnapshot.years_of_data)} · ${relativeSnapshot.points_count} points`;
    toolNodes.pe = (
      <DistributionTool
        title="PE ratio · vs own history"
        subtitle={subtitle}
        snapshot={relativeSnapshot.pe}
        formatValue={(v) => `${v.toFixed(1)}x`}
      />
    );
    toolNodes.pfcf = (
      <DistributionTool
        title="P/FCF ratio · vs own history"
        subtitle={subtitle}
        snapshot={invertYieldToMultipleSnapshot(relativeSnapshot.fcf_yield)}
        formatValue={(v) => `${v.toFixed(1)}x`}
      />
    );
    if (relativeSnapshot.pb) {
      toolNodes.pb = (
        <DistributionTool
          title="P/B ratio · vs own history"
          subtitle={subtitle}
          snapshot={relativeSnapshot.pb}
          formatValue={(v) => `${v.toFixed(2)}x`}
        />
      );
    }
  }

  // Split into visible (recommended) and hidden, preserving canonical order.
  const visibleTools: ToolId[] = [];
  const hiddenTools: ToolId[] = [];
  for (const t of TOOL_RENDER_ORDER) {
    if (!toolNodes[t]) continue;
    if (recommendedTools.has(t)) visibleTools.push(t);
    else hiddenTools.push(t);
  }

  // History-length disclaimer attaches to whichever section first surfaces
  // a relative tool — the warning is about distribution data quality, so it
  // belongs next to the tools it actually applies to.
  const showHistoryNote =
    relativeSnapshot !== null && relativeSnapshot.years_of_data < 5;
  const visibleHasRelative = visibleTools.some((t) => RELATIVE_TOOLS.has(t));
  const hiddenHasRelative = hiddenTools.some((t) => RELATIVE_TOOLS.has(t));

  return (
    <div className="space-y-4">
      {guide && (
        <ValuationGuideBlock
          guide={guide}
          dcfTier={valuation.dcf_tier}
          relativeSnapshot={relativeSnapshot}
          method={valuation.method}
          treasuryCurrent={treasuryCurrent}
          recommendedTools={recommendedTools}
        />
      )}

      {showHistoryNote && visibleHasRelative && (
        <HistoryLengthNote years={relativeSnapshot!.years_of_data} />
      )}

      {visibleTools.map((t) => (
        <div key={t}>{toolNodes[t]}</div>
      ))}

      {hiddenTools.length > 0 && (
        <details className="rounded-lg border border-navy-200 bg-white">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-navy-700 hover:text-navy-900">
            View other valuation tools ({hiddenTools.length})
          </summary>
          <div className="space-y-4 border-t border-navy-100 p-4">
            {showHistoryNote && !visibleHasRelative && hiddenHasRelative && (
              <HistoryLengthNote years={relativeSnapshot!.years_of_data} />
            )}
            {hiddenTools.map((t) => (
              <div key={t}>{toolNodes[t]}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function formatYears(years: number): string {
  return years >= 1 ? `${years.toFixed(1)}y history` : "<1y history";
}

// Passive disclosure: when the business's own multiple history is shorter
// than a full economic cycle, the distribution's median/Q1/Q3 are less
// reliable as anchors. Rendered once above the three relative tools. No
// color, no verdict — a factual note the eye can skip if the reader wants.
function HistoryLengthNote({ years }: { years: number }) {
  const label = years >= 1 ? `${years.toFixed(1)} years` : "under 1 year";
  return (
    <div className="rounded-lg border border-navy-200 bg-navy-50/30 px-4 py-3">
      <p className="text-xs leading-relaxed text-navy-600">
        Distribution computed on {label} of data — shorter than a full
        economic cycle, so the median, Q1 and Q3 are less reliable as
        anchors. Weigh accordingly.
      </p>
    </div>
  );
}

// ─── Tool 1 · DCF ─────────────────────────────────────────────────────────

function DcfTool({
  positionId,
  valuation,
  intrinsicBase,
  intrinsicLow,
  intrinsicHigh,
  currentPrice,
}: {
  positionId: number;
  valuation: Valuation;
  intrinsicBase: number;
  intrinsicLow: number;
  intrinsicHigh: number;
  currentPrice: number;
}) {
  const hasRange =
    valuation.method !== "ai_multiples" && intrinsicLow !== intrinsicHigh;
  const methodLabel =
    valuation.method === "dcf"
      ? "Owner earnings two-stage DCF"
      : valuation.method === "affo_dcf"
        ? "AFFO-based DCF (real estate)"
        : valuation.method === "excess_returns"
          ? "Excess Returns Model (banks / insurers)"
          : "AI multiples (DCF not applicable)";

  // Terminal-value concentration note (V1, OQ3 threshold 75%). Only relevant
  // for DCF-based methods — the Excess Returns Model has no Gordon
  // perpetuity (excess returns fade to zero by year 10 by construction).
  const pvBreakdown =
    valuation.method === "dcf" || valuation.method === "affo_dcf"
      ? (valuation.assumptions as DcfStoredAssumptions).pv_breakdown
      : undefined;
  const terminalWarning =
    pvBreakdown !== undefined && pvBreakdown.terminal_pct > 0.75;

  return (
    <ToolContainer
      title={`Intrinsic value · ${methodLabel}`}
      subtitle={hasRange ? "Bear / Base / Bull + current price" : undefined}
    >
      {hasRange ? (
        <IvRangeBar
          bear={intrinsicLow}
          base={intrinsicBase}
          bull={intrinsicHigh}
          price={currentPrice}
        />
      ) : (
        <IvSinglePoint
          intrinsic={intrinsicBase}
          current={currentPrice}
        />
      )}

      {terminalWarning && pvBreakdown && (
        <TerminalConcentrationNote
          terminalPct={pvBreakdown.terminal_pct}
          stageOnePct={pvBreakdown.stage_one_pct}
          stageTwoPct={pvBreakdown.stage_two_pct}
        />
      )}

      <details className="mt-5 border-t border-navy-200 pt-4">
        <summary className="cursor-pointer text-sm font-medium text-navy-700 hover:text-navy-900">
          How we calculated this
        </summary>
        <div className="mt-4">
          {valuation.method === "dcf" || valuation.method === "affo_dcf" ? (
            <DcfDetails
              positionId={positionId}
              assumptions={valuation.assumptions as DcfStoredAssumptions}
              intrinsicBase={intrinsicBase}
              intrinsicLow={intrinsicLow}
              intrinsicHigh={intrinsicHigh}
              method={valuation.method}
            />
          ) : valuation.method === "excess_returns" ? (
            <ExcessReturnsDetails
              assumptions={
                valuation.assumptions as ExcessReturnsStoredAssumptions
              }
              intrinsicBase={intrinsicBase}
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
    </ToolContainer>
  );
}

// Navy-neutral IV range bar. Shows bear/base/bull and current price marker;
// the bottom line is descriptive, not prescriptive — no "margin of safety"
// copy, no red/green dot, no verdict.
function IvRangeBar({
  bear,
  base,
  bull,
  price,
}: {
  bear: number;
  base: number;
  bull: number;
  price: number;
}) {
  const rangeSpan = Math.max(bull - bear, bull * 0.01);
  const scaleMin = Math.min(bear, price) - rangeSpan * 0.1;
  const scaleMax = Math.max(bull, price) + rangeSpan * 0.1;
  const scaleSpan = scaleMax - scaleMin;

  const pct = (v: number) => ((v - scaleMin) / scaleSpan) * 100;
  const bearPct = pct(bear);
  const basePct = pct(base);
  const bullPct = pct(bull);
  const pricePct = Math.max(0, Math.min(100, pct(price)));

  const priceVsBasePct = (price / base - 1) * 100;
  const priceVsBaseText =
    priceVsBasePct >= 0
      ? `Price is ${priceVsBasePct.toFixed(1)}% above base IV`
      : `Price is ${Math.abs(priceVsBasePct).toFixed(1)}% below base IV`;

  return (
    <div className="mt-2">
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
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-100" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-400"
          style={{ left: `${bearPct}%`, width: `${bullPct - bearPct}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-blue-700"
          style={{ left: `${basePct}%` }}
          aria-label="base case"
        />

        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${pricePct}%` }}
        >
          <div className="mx-auto h-4 w-4 rotate-45 rounded-sm border-2 border-white bg-blue-900 shadow" />
          <div className="mt-0.5 whitespace-nowrap text-[10px] font-semibold text-navy-900">
            Price ${price.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Legend row under the bar */}
      <div className="relative mt-1 h-4 text-[10px] font-medium uppercase tracking-wider text-navy-500">
        <span className="absolute -translate-x-1/2" style={{ left: `${bearPct}%` }}>
          Bear
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${basePct}%` }}>
          Base
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${bullPct}%` }}>
          Bull
        </span>
      </div>

      <div className="mt-4 border-t border-navy-100 pt-3 text-xs text-navy-500">
        {priceVsBaseText}.
      </div>
    </div>
  );
}

function IvSinglePoint({
  intrinsic,
  current,
}: {
  intrinsic: number;
  current: number;
}) {
  const vsIntrinsicPct = (current / intrinsic - 1) * 100;
  return (
    <div className="mt-2 grid gap-4 sm:grid-cols-3 sm:divide-x sm:divide-navy-200/60">
      <NeutralStat label="Intrinsic value" value={`$${intrinsic.toFixed(2)}`} />
      <NeutralStat label="Current price" value={`$${current.toFixed(2)}`} />
      <NeutralStat
        label="Price vs IV"
        value={`${vsIntrinsicPct >= 0 ? "+" : ""}${vsIntrinsicPct.toFixed(1)}%`}
      />
    </div>
  );
}

// Terminal-value concentration note (V1, audit 2026-04-18). Fires only when
// the Gordon-perpetuity PV at the base hurdle exceeds 75% of enterprise
// value — the regime Damodaran warns against trusting without sensitivity
// analysis (the "Coca-Cola 1998" pattern, where IV is dominated by what the
// business is assumed to do beyond year 10). No color, no verdict — a
// factual disclosure.
function TerminalConcentrationNote({
  terminalPct,
  stageOnePct,
  stageTwoPct,
}: {
  terminalPct: number;
  stageOnePct: number;
  stageTwoPct: number;
}) {
  const fmt = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="mt-4 rounded-md border border-navy-300 bg-navy-50 px-4 py-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-700">
        Terminal-value concentration
      </div>
      <p className="text-xs leading-relaxed text-navy-700">
        {fmt(terminalPct)} of this valuation comes from the perpetuity beyond
        year 10 ({fmt(stageOnePct)} years 1–5, {fmt(stageTwoPct)} years 6–10).
        At this level, IV is dominated by long-term assumptions the DCF
        cannot verify — handle with the appropriate caution.
      </p>
    </div>
  );
}

// ─── Tool 2 & 3 · Relative distribution (PE / P/FCF) ─────────────────────

function DistributionTool({
  title,
  subtitle,
  snapshot,
  formatValue,
}: {
  title: string;
  subtitle: string;
  snapshot: RelativeMetricSnapshot;
  formatValue: (v: number) => string;
}) {
  // Hide the tool entirely when the distribution can't be rendered — we
  // prefer absence to a placeholder that clutters the toolkit without
  // adding signal.
  if (
    snapshot.current === null ||
    snapshot.median === null ||
    snapshot.q1 === null ||
    snapshot.q3 === null ||
    snapshot.min === null ||
    snapshot.max === null
  ) {
    return null;
  }

  return (
    <ToolContainer title={title} subtitle={subtitle}>
      <DistributionBar
        min={snapshot.min}
        q1={snapshot.q1}
        median={snapshot.median}
        q3={snapshot.q3}
        max={snapshot.max}
        current={snapshot.current}
        formatValue={formatValue}
      />

      <table className="mt-5 w-full text-xs tabular-nums">
        <tbody className="divide-y divide-navy-100">
          <DistributionRow label="Current" value={formatValue(snapshot.current)} emphasized />
          <DistributionRow label="Median" value={formatValue(snapshot.median)} />
          <DistributionRow
            label="Q1 — Q3"
            value={`${formatValue(snapshot.q1)} — ${formatValue(snapshot.q3)}`}
          />
          <DistributionRow
            label="Historical range (excl. outliers)"
            value={`${formatValue(snapshot.min)} — ${formatValue(snapshot.max)}`}
          />
          {snapshot.current_percentile !== null && (
            <DistributionRow
              label="Current percentile"
              value={`${Math.round(snapshot.current_percentile)}th`}
            />
          )}
        </tbody>
      </table>
    </ToolContainer>
  );
}

function DistributionRow({
  label,
  value,
  emphasized,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <tr>
      <td className="py-1.5 text-navy-500">{label}</td>
      <td
        className={`py-1.5 text-right ${emphasized ? "font-bold text-navy-900" : "font-medium text-navy-900"}`}
      >
        {value}
      </td>
    </tr>
  );
}

// Horizontal mini-bar: Min → Q1 → Median → Q3 → Max + current marker.
// Navy neutral. Q1-Q3 band is a slightly darker shade than min-max band so
// the IQR is visually readable without adding semantic color.
function DistributionBar({
  min,
  q1,
  median,
  q3,
  max,
  current,
  formatValue,
}: {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  current: number;
  formatValue: (v: number) => string;
}) {
  const span = Math.max(max - min, Math.max(max, current) * 0.01);
  const scaleMin = Math.min(min, current) - span * 0.1;
  const scaleMax = Math.max(max, current) + span * 0.1;
  const scaleSpan = scaleMax - scaleMin;
  const pctOf = (v: number) => ((v - scaleMin) / scaleSpan) * 100;

  const minPct = pctOf(min);
  const q1Pct = pctOf(q1);
  const medianPct = pctOf(median);
  const q3Pct = pctOf(q3);
  const maxPct = pctOf(max);
  const currentPct = Math.max(0, Math.min(100, pctOf(current)));

  return (
    <div className="mt-2">
      {/* Top labels: only current + median for legibility */}
      <div className="relative h-5 text-[11px] font-semibold tabular-nums">
        <span
          className="absolute -translate-x-1/2 text-navy-900"
          style={{ left: `${medianPct}%` }}
        >
          {formatValue(median)}
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-9">
        {/* Full range (min → max) */}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-200"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
        />
        {/* IQR (Q1 → Q3) */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500"
          style={{ left: `${q1Pct}%`, width: `${q3Pct - q1Pct}%` }}
        />
        {/* Median tick */}
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-blue-700"
          style={{ left: `${medianPct}%` }}
          aria-label="median"
        />
        {/* Current marker (diamond) */}
        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${currentPct}%` }}
        >
          <div className="mx-auto h-4 w-4 rotate-45 rounded-sm border-2 border-white bg-blue-900 shadow" />
          <div className="mt-0.5 whitespace-nowrap text-[10px] font-semibold text-navy-900">
            {formatValue(current)}
          </div>
        </div>
      </div>

      {/* Legend row */}
      <div className="relative mt-1 h-4 text-[10px] font-medium uppercase tracking-wider text-navy-500">
        <span className="absolute -translate-x-1/2" style={{ left: `${minPct}%` }}>
          Min
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${q1Pct}%` }}>
          Q1
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${medianPct}%` }}>
          Median
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${q3Pct}%` }}>
          Q3
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${maxPct}%` }}>
          Max
        </span>
      </div>
    </div>
  );
}

// Inverts a FCF-yield snapshot into a P/FCF-multiple snapshot (1/yield).
// Q1↔Q3 and min↔max flip because the ordering reverses when inverting.
function invertYieldToMultipleSnapshot(
  y: RelativeMetricSnapshot,
): RelativeMetricSnapshot {
  const inv = (x: number | null): number | null =>
    x !== null && x > 0 ? 1 / x : null;
  return {
    current: inv(y.current),
    median: inv(y.median),
    q1: inv(y.q3),
    q3: inv(y.q1),
    min: inv(y.max),
    max: inv(y.min),
    current_percentile:
      y.current_percentile !== null ? 100 - y.current_percentile : null,
  };
}


// ─── Shared container ─────────────────────────────────────────────────────

function ToolContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-navy-200 bg-navy-50/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-bold text-navy-900">{title}</h3>
        {subtitle && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-navy-500">
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function NeutralStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1 sm:first:pl-0 sm:px-5 sm:last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-navy-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-navy-900">
        {value}
      </div>
    </div>
  );
}

// ─── DCF "How we calculated this" details ────────────────────────────────

function DcfDetails({
  positionId,
  assumptions,
  intrinsicBase,
  intrinsicLow,
  intrinsicHigh,
  method,
}: {
  positionId: number;
  assumptions: DcfStoredAssumptions;
  intrinsicBase: number;
  intrinsicLow: number;
  intrinsicHigh: number;
  method: "dcf" | "affo_dcf";
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
          {method === "affo_dcf" ? "AFFO approximation (base year)" : "Owner earnings (base year)"}
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
              label={method === "affo_dcf" ? "= AFFO (approximation)" : "= Owner earnings"}
              value={
                <span className="font-semibold">
                  {formatLargeUSD(assumptions.owner_earnings_base)}
                </span>
              }
            />
          </tbody>
        </table>
        {method === "affo_dcf" && (
          <p className="mt-1 text-[11px] text-navy-500">
            For real-estate businesses, NI + D&amp;A − maintenance capex
            approximates Funds From Operations minus maintenance capex —
            the AFFO convention.
          </p>
        )}
        {assumptions.base_note && (
          <p className="mt-1 text-[11px] text-navy-500">{assumptions.base_note}</p>
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

      {assumptions.pv_breakdown && (
        <div>
          <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
            Present-value concentration (base hurdle)
          </h5>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-navy-100">
              <Row
                label="Years 1–5 (Stage 1)"
                value={`${Math.round(assumptions.pv_breakdown.stage_one_pct * 100)}%`}
              />
              <Row
                label="Years 6–10 (Stage 2 fade)"
                value={`${Math.round(assumptions.pv_breakdown.stage_two_pct * 100)}%`}
              />
              <Row
                label="Beyond year 10 (Gordon perpetuity)"
                value={
                  <span className="font-semibold">
                    {`${Math.round(assumptions.pv_breakdown.terminal_pct * 100)}%`}
                  </span>
                }
              />
            </tbody>
          </table>
          <p className="mt-1 text-[11px] leading-relaxed text-navy-500">
            Share of enterprise value coming from each horizon. A
            terminal-heavy mix means IV depends largely on long-term
            assumptions the DCF cannot verify.
          </p>
        </div>
      )}

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

function ExcessReturnsDetails({
  assumptions,
  intrinsicBase,
  intrinsicLow,
  intrinsicHigh,
}: {
  assumptions: ExcessReturnsStoredAssumptions;
  intrinsicBase: number;
  intrinsicLow: number;
  intrinsicHigh: number;
}) {
  const bvPerShare =
    assumptions.shares_outstanding > 0
      ? assumptions.book_value / assumptions.shares_outstanding
      : 0;
  const excessReturnPct =
    (assumptions.stable_roe - assumptions.cost_of_equity) * 100;

  return (
    <div className="space-y-5">
      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Excess Returns Model (Damodaran)
        </h5>
        <p className="mb-3 text-[11px] leading-relaxed text-navy-500">
          Intrinsic value = current book value + present value of economic
          profits (ROE above Cost of Equity) over a 10-year horizon, fading
          to zero excess returns at year 10 (competitive equilibrium).
        </p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row
              label="Book value (stockholders' equity)"
              value={formatLargeUSD(assumptions.book_value)}
            />
            <Row
              label="Book value per share"
              value={`$${bvPerShare.toFixed(2)}`}
            />
            <Row
              label={`Stable ROE (${assumptions.years_of_history}y median)`}
              value={`${(assumptions.stable_roe * 100).toFixed(1)}%`}
            />
            <Row
              label="Retention ratio (1 − payout)"
              value={`${(assumptions.retention_ratio * 100).toFixed(0)}%`}
            />
          </tbody>
        </table>
        {assumptions.base_note && (
          <p className="mt-1 text-[11px] text-navy-500">
            {assumptions.base_note}
          </p>
        )}
      </div>

      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Cost of Equity (CAPM)
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row
              label="Risk-free rate (US 10y Treasury, spot)"
              value={`${(assumptions.risk_free_rate * 100).toFixed(2)}%`}
            />
            <Row
              label="Beta"
              value={
                assumptions.beta !== null
                  ? assumptions.beta.toFixed(2)
                  : "1.00 (not reported)"
              }
            />
            <Row
              label="Equity risk premium (US historical)"
              value={`${(assumptions.equity_risk_premium * 100).toFixed(1)}%`}
            />
            <Row
              label="= Cost of Equity"
              value={
                <span className="font-semibold">
                  {`${(assumptions.cost_of_equity * 100).toFixed(2)}%`}
                </span>
              }
            />
            <Row
              label="Excess return (ROE − Ke)"
              value={
                <span
                  className={
                    excessReturnPct >= 0
                      ? "font-semibold text-navy-900"
                      : "font-semibold text-navy-900"
                  }
                >
                  {excessReturnPct >= 0 ? "+" : ""}
                  {excessReturnPct.toFixed(2)} pp
                </span>
              }
            />
          </tbody>
        </table>
      </div>

      <div>
        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          Intrinsic value range
        </h5>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <Row
              label={`Bear (Ke ${(assumptions.hurdle_rates.low * 100).toFixed(1)}%)`}
              value={`$${intrinsicLow.toFixed(2)}`}
            />
            <Row
              label={`Base (Ke ${(assumptions.hurdle_rates.base * 100).toFixed(1)}%)`}
              value={
                <span className="font-semibold">
                  {`$${intrinsicBase.toFixed(2)}`}
                </span>
              }
            />
            <Row
              label={`Bull (Ke ${(assumptions.hurdle_rates.high * 100).toFixed(1)}%)`}
              value={`$${intrinsicHigh.toFixed(2)}`}
            />
            <Row
              label="Shares outstanding"
              value={formatShares(assumptions.shares_outstanding)}
            />
          </tbody>
        </table>
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

// ─── Valuation Guide block ────────────────────────────────────────────────
//
// AI-generated advice on which tools to prioritize for this business type.
// Rendered at the top of the toolkit so the reader has a marco before
// scanning the five tools. Deliberately understated visually — a briefing,
// not a verdict. Cached per ticker (TTL 365d) in `valuation_guides` table.

// Cash yield is intentionally omitted from this label map: it's an
// indicator that moved to Additional Signals on the analysis card, not a
// valuation method. Legacy cached guides that still reference `cash_yield`
// are invalidated in `ensureValuationGuide`.
const TOOL_LABELS: Partial<Record<ToolId, string>> & {
  dcf: string;
  pe: string;
  pfcf: string;
  pb: string;
} = {
  dcf: "DCF range",
  pe: "PE vs own history",
  pfcf: "P/FCF vs own history",
  pb: "P/B vs own history",
  cash_yield: "Cash yield vs risk-free",
};

function ValuationGuideBlock({
  guide,
  dcfTier,
  relativeSnapshot,
  method,
  treasuryCurrent,
  recommendedTools,
}: {
  guide: ValuationGuide;
  dcfTier: DcfTier;
  relativeSnapshot: RelativeValuationSnapshot | null;
  method: ValuationMethod;
  treasuryCurrent: number | null;
  recommendedTools: Set<ToolId>;
}) {
  return (
    <div className="rounded-lg border border-navy-200 border-l-4 border-l-navy-500 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-bold text-navy-900">
          How to weigh these for this business
        </h3>
        <span className="text-[11px] font-medium uppercase tracking-wider text-navy-400">
          AI guidance
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-navy-700">
        {guide.reasoning}
      </p>

      <div className="mt-4 space-y-1.5 border-t border-navy-100 pt-3 text-sm">
        <GuideRow label="Primary" tool={guide.primary_tool} role="trust" />
        {guide.secondary_tool && (
          <GuideRow
            label="Secondary"
            tool={guide.secondary_tool}
            role="trust"
          />
        )}
        {guide.cautious_tool && (
          <GuideRow
            label="Interpret with care"
            tool={guide.cautious_tool}
            role="caution"
          />
        )}
      </div>

      <ReadingSignalBlock
        dcfTier={dcfTier}
        relativeSnapshot={relativeSnapshot}
        method={method}
        recommendedTools={recommendedTools}
      />

      <FcfYieldVsTreasuryNote
        relativeSnapshot={relativeSnapshot}
        treasuryCurrent={treasuryCurrent}
      />

      <p className="mt-4 text-[10px] italic text-navy-400">
        AI-generated guidance. Always check the data yourself — this is a
        briefing, not a verdict.
      </p>
    </div>
  );
}

// ─── Reading signal (V5) ──────────────────────────────────────────────────
//
// Factual per-tool summary at current price: where the DCF's Margin-of-
// Safety classification lands, and which quartile of its own history the
// PE / P/FCF / P/B multiples sit in. No color semantics on the cells,
// no aggregated verdict. Purpose: let the reader see at a glance whether
// the signals are aligned (e.g. DCF "Premium" + PE above Q3 + P/FCF above
// Q3 = every tool points to elevated valuation) without the framework
// imposing a single conclusion.

function percentileToQuartileLabel(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  if (p < 25) return "Q1 (low side)";
  if (p < 50) return "Between Q1 and median";
  if (p < 75) return "Between median and Q3";
  return "Above Q3 (high side)";
}

function ReadingSignalBlock({
  dcfTier,
  relativeSnapshot,
  method,
  recommendedTools,
}: {
  dcfTier: DcfTier;
  relativeSnapshot: RelativeValuationSnapshot | null;
  method: ValuationMethod;
  // Subset of tools to surface here (typically primary + secondary from the
  // guide). When null, all cells render — fallback for the rare case of no
  // guide row.
  recommendedTools: Set<ToolId> | null;
}) {
  const dcfLabel = MOS_TIER_LABELS[dcfTier];
  const dcfMethodLabel =
    method === "dcf"
      ? "DCF"
      : method === "affo_dcf"
        ? "AFFO DCF"
        : method === "excess_returns"
          ? "Excess Returns"
          : "AI multiples";

  const peQuartile = relativeSnapshot
    ? percentileToQuartileLabel(relativeSnapshot.pe.current_percentile)
    : null;
  // P/FCF quartile: stored snapshot is FCF yield (higher = cheaper); invert
  // by flipping the percentile so "Above Q3 (high side)" means expensive.
  const pfcfPercentile =
    relativeSnapshot && relativeSnapshot.fcf_yield.current_percentile !== null
      ? 100 - relativeSnapshot.fcf_yield.current_percentile
      : null;
  const pfcfQuartile = relativeSnapshot
    ? percentileToQuartileLabel(pfcfPercentile)
    : null;
  const pbQuartile =
    relativeSnapshot?.pb?.current_percentile !== undefined &&
    relativeSnapshot?.pb?.current_percentile !== null
      ? percentileToQuartileLabel(relativeSnapshot.pb.current_percentile)
      : null;

  const showCell = (tool: ToolId): boolean =>
    recommendedTools === null || recommendedTools.has(tool);

  const cells: React.ReactNode[] = [];
  if (showCell("dcf")) {
    cells.push(
      <SignalCell
        key="dcf"
        tool={`Absolute valuation (${dcfMethodLabel})`}
        value={dcfLabel}
      />,
    );
  }
  if (showCell("pe") && peQuartile) {
    cells.push(
      <SignalCell key="pe" tool="PE vs own history" value={peQuartile} />,
    );
  }
  if (showCell("pfcf") && pfcfQuartile) {
    cells.push(
      <SignalCell
        key="pfcf"
        tool="P/FCF vs own history"
        value={pfcfQuartile}
      />,
    );
  }
  if (showCell("pb") && pbQuartile) {
    cells.push(
      <SignalCell key="pb" tool="P/B vs own history" value={pbQuartile} />,
    );
  }

  // No recommended tool produced a renderable signal — skip the block
  // entirely rather than show an empty container.
  if (cells.length === 0) return null;

  return (
    <div className="mt-4 rounded-md border border-navy-200 bg-navy-50/40 p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-navy-600">
        Reading signal at current price
      </div>
      <div className="grid gap-2.5 text-sm sm:grid-cols-2">{cells}</div>
      <p className="mt-3 text-[11px] leading-relaxed text-navy-500">
        Factual read — not a verdict. When the recommended tools point the
        same way, the signal is aligned; when they disagree, weigh them per
        the guidance above.
      </p>
    </div>
  );
}

function SignalCell({ tool, value }: { tool: string; value: string }) {
  return (
    <div className="rounded border border-navy-100 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
        {tool}
      </div>
      <div className="mt-0.5 text-sm font-medium text-navy-900">{value}</div>
    </div>
  );
}

// FCF yield vs risk-free cross-check (V2c, audit 2026-04-18). Fires only
// when the business's current FCF yield is below the 10y Treasury AND the
// PE sits at the 70th percentile or higher of its own history — the
// "priced for growth, not yield" regime that own-history alone can miss
// when the entire history has been in a bubble (KO 1991-1998). No color,
// no verdict — factual disclosure.
function FcfYieldVsTreasuryNote({
  relativeSnapshot,
  treasuryCurrent,
}: {
  relativeSnapshot: RelativeValuationSnapshot | null;
  treasuryCurrent: number | null;
}) {
  if (!relativeSnapshot || treasuryCurrent === null) return null;
  const fcfYield = relativeSnapshot.fcf_yield.current;
  const pePercentile = relativeSnapshot.pe.current_percentile;
  if (
    fcfYield === null ||
    fcfYield <= 0 ||
    pePercentile === null ||
    fcfYield >= treasuryCurrent ||
    pePercentile < 70
  ) {
    return null;
  }
  return (
    <div className="mt-4 rounded-md border border-navy-300 bg-navy-50 px-4 py-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-700">
        FCF yield vs risk-free
      </div>
      <p className="text-xs leading-relaxed text-navy-700">
        Current FCF yield ({(fcfYield * 100).toFixed(1)}%) is below the 10y
        Treasury ({(treasuryCurrent * 100).toFixed(1)}%), and PE sits in the
        top {Math.round(100 - pePercentile)}% of the business&apos;s own
        history — the business is priced for growth, not yield. Own-history
        distributions can miss this when the historical window was itself
        expensive.
      </p>
    </div>
  );
}

function GuideRow({
  label,
  tool,
  role,
}: {
  label: string;
  tool: ToolId;
  role: "trust" | "caution";
}) {
  // Color the label by role to reinforce the semantic: primary / secondary
  // are tools to trust (emerald); "interpret with care" is a warning
  // (red). Same palette as the Quality Scorecard so the vocabulary is
  // consistent across the product.
  const labelColor =
    role === "trust" ? "text-emerald-700" : "text-red-700";
  return (
    <div className="flex items-baseline gap-3">
      <span
        className={`w-44 flex-none text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}
      >
        {label}
      </span>
      <span className="font-medium text-navy-900">
        {TOOL_LABELS[tool] ?? tool}
      </span>
    </div>
  );
}
