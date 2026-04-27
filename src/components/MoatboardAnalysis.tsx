"use client";

import { useState, useTransition } from "react";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type { Fundamentals } from "@/lib/financial";
import type { Tier, MoatArchetype, MoatStrength } from "@/lib/verdict";
import { runAnalysisAction } from "@/app/dashboard/position/[id]/actions";
import { scoreMetric, type MultiYearScore } from "@/lib/scorecard";
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
  cashYieldContext,
  loadError,
  hideRegenerate = false,
}: {
  positionId: number;
  ticker: string;
  analysis: Analysis | null;
  fundamentals: Fundamentals | null;
  // Optional context for the "Cash Yield" card in Additional Signals.
  // Populated from the current valuation's snapshot + Treasury yield;
  // null when either input is missing, in which case the card hides.
  cashYieldContext?: { fcfYield: number; treasuryYield: number } | null;
  loadError?: string | null;
  // Set true inside the analysis wizard where the user is walking through
  // the analysis once. Regeneration is available later from the position
  // page after investing.
  hideRegenerate?: boolean;
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
          {analysis && !hideRegenerate && (
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
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="mb-1 text-base font-bold text-navy-900">
                Quality Scorecard
              </h3>
              <div className="text-xs text-navy-500">
                {scorecardDescription(analysis?.scorecard_summary)}
              </div>
            </div>
          </div>
          <div className="space-y-5">
            <ScorecardGroup title="Business quality — scored">
              {buildScoredCards({ analysis, fundamentals }).map((card) => (
                <ScorecardCard
                  key={card.label}
                  label={card.label}
                  hint={card.hint}
                  value={card.value}
                  quality={card.quality}
                  latestValue={card.latestValue}
                  median={card.median}
                  higherIsBetter={card.higherIsBetter}
                />
              ))}
            </ScorecardGroup>
            <HiddenDimensionsNote analysis={analysis} />

            <div>
              <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-navy-400">
                Additional signals
              </h4>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {buildAdditionalSignals({
                  analysis,
                  fundamentals,
                  cashYieldContext,
                }).map(
                  (card) => (
                    <ScorecardCard
                      key={card.label}
                      compact
                      label={card.label}
                      hint={card.hint}
                      value={card.value}
                      quality={card.quality}
                    />
                  ),
                )}
              </div>
            </div>
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

// Per-dimension default reason for being hidden. Used as fallback when
// the scorecard hasn't attached a more specific note (sector neutral,
// insufficient history). Keys mirror ScorecardSummary.dimensions.
const DIMENSION_INFO: Array<{
  key: keyof import("@/lib/verdict").ScorecardSummary["dimensions"];
  label: string;
  applicableNote: string;
  // Lookup the matching MultiYearScore key (for note retrieval).
  multiYearKey?: keyof import("@/lib/verdict").ScorecardSummary["multiYear"];
}> = [
  {
    key: "returnOnInvestedCapital",
    label: "ROIC",
    applicableNote: "Solo se mide en negocios producto (no aplica a balance sheet o REITs)",
    multiYearKey: "returnOnInvestedCapital",
  },
  {
    key: "grossMargin",
    label: "Gross Margin",
    applicableNote: "Solo se mide en negocios producto",
    multiYearKey: "grossMargin",
  },
  {
    key: "fcfMargin",
    label: "FCF Margin",
    applicableNote: "Solo se mide en negocios producto",
    multiYearKey: "fcfMargin",
  },
  {
    key: "operatingMargins",
    label: "Operating Margin",
    applicableNote: "Sin datos suficientes",
    multiYearKey: "operatingMargin",
  },
  {
    key: "shareCountTrend",
    label: "Share Count Trend",
    applicableNote: "Sin datos suficientes",
    multiYearKey: "shareCountTrend",
  },
  {
    key: "revenueGrowth",
    label: "Revenue Growth",
    applicableNote: "Sin datos suficientes",
    multiYearKey: "revenueGrowth",
  },
  {
    key: "debtToEquity",
    label: "Debt / Equity",
    applicableNote: "Solo se mide en negocios producto",
  },
  {
    key: "returnOnEquity",
    label: "ROE (multi-year)",
    applicableNote: "Solo se mide en bancos / aseguradoras / mortgage REITs",
    multiYearKey: "returnOnEquity",
  },
  {
    key: "returnOnAssets",
    label: "ROA (multi-year)",
    applicableNote: "Solo se mide en bancos / aseguradoras / mortgage REITs",
    multiYearKey: "returnOnAssets",
  },
  {
    key: "bookValuePerShareCagr",
    label: "BV/share CAGR",
    applicableNote: "Solo se mide en bancos / aseguradoras / mortgage REITs",
    multiYearKey: "bookValuePerShareCagr",
  },
  {
    key: "affoPayoutRatio",
    label: "AFFO Payout Ratio",
    applicableNote: "Solo se mide en equity REITs",
  },
  {
    key: "netDebtToEbitda",
    label: "Net Debt / EBITDA",
    applicableNote: "Solo se mide en equity REITs",
  },
  {
    key: "affoPerShareCagr",
    label: "AFFO/share CAGR",
    applicableNote: "Solo se mide en equity REITs",
    multiYearKey: "affoPerShareCagr",
  },
];

// Translate the English "note" attached to a MultiYearScore by the scorer
// to user-facing Spanish copy. The English notes come from scorecard.ts
// and are kept short + factual; here we localize.
function localizeNote(note: string): string {
  if (note === "Not a quality signal for this sector") {
    return "No es señal de calidad en este sector";
  }
  if (note === "Insufficient history (<3 years)") {
    return "Histórico insuficiente (menos de 3 años)";
  }
  return note;
}

function HiddenDimensionsNote({
  analysis,
}: {
  analysis: Analysis | null;
}) {
  if (!analysis?.scorecard_summary) return null;
  const s = analysis.scorecard_summary;

  type Hidden = { label: string; reason: string };
  const hidden: Hidden[] = [];
  for (const info of DIMENSION_INFO) {
    if (s.dimensions[info.key] !== "neutral") continue;
    let reason = info.applicableNote;
    if (info.multiYearKey) {
      const note = s.multiYear[info.multiYearKey]?.note;
      if (note) reason = localizeNote(note);
    } else if (info.key === "debtToEquity") {
      const note = s.notes?.debtToEquity;
      if (note) reason = localizeNote(note);
    }
    hidden.push({ label: info.label, reason });
  }

  if (hidden.length === 0) return null;

  // Group dimensions sharing the same reason to keep the note compact.
  const grouped = new Map<string, string[]>();
  for (const h of hidden) {
    if (!grouped.has(h.reason)) grouped.set(h.reason, []);
    grouped.get(h.reason)!.push(h.label);
  }

  return (
    <div className="rounded-md border border-navy-100 bg-navy-50/40 px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-navy-500">
        Dimensiones no medidas para este negocio
      </div>
      <div className="mt-1.5 space-y-1">
        {Array.from(grouped.entries()).map(([reason, labels]) => (
          <div
            key={reason}
            className="text-[11px] leading-relaxed text-navy-600"
          >
            <span className="font-medium text-navy-700">
              {labels.join(" · ")}
            </span>
            <span className="ml-1.5 italic text-navy-500">— {reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function verdictBoxStyles(tier: Tier): string {
  switch (tier) {
    case "exceptional":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "good":
      return "border-teal-200 bg-teal-50 text-teal-900";
    case "mediocre":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "poor":
      return "border-red-200 bg-red-50 text-red-900";
  }
}

type ScoredCard = {
  label: string;
  hint: string;
  value: string;
  quality: "strong" | "acceptable" | "weak" | "neutral";
  // Triangulation hint props — passed straight through to ScorecardCard.
  // latestValue is fraction (e.g. 0.192 for 19.2%), same convention as
  // median. isCagr=true when median is actually a CAGR (revenue growth,
  // BV/share, AFFO/share, share count). higherIsBetter false for share
  // count, AFFO payout, Net Debt/EBITDA, Debt/Equity.
  latestValue?: number | null;
  median?: number | null;
  isCagr?: boolean;
  higherIsBetter?: boolean;
};

// Build the list of scored cards to render in Business Quality. The logic:
// every potential dimension is attempted; only those whose quality is NOT
// neutral end up rendered. That way banks see ROE/ROA/BV-CAGR (their three
// applicable additions) and don't see ROIC/Gross/FCF Margin (neutralized for
// their business type), and REITs see AFFO-specific cards, all without the
// UI having to know the sector — the dispatch lives in scorecard.ts.
function buildScoredCards({
  analysis,
  fundamentals,
}: {
  analysis: Analysis | null;
  fundamentals: Fundamentals;
}): ScoredCard[] {
  const cards: ScoredCard[] = [];
  const s = analysis?.scorecard_summary;

  if (s) {
    cards.push({
      label: "ROIC",
      hint: multiYearHint(s.multiYear.returnOnInvestedCapital),
      value: formatPct(s.multiYear.returnOnInvestedCapital.median),
      quality: s.dimensions.returnOnInvestedCapital,
      latestValue: s.multiYear.returnOnInvestedCapital.latestValue,
      median: s.multiYear.returnOnInvestedCapital.median,
    });
    cards.push({
      label: "Gross Margin",
      hint: multiYearHint(s.multiYear.grossMargin),
      value: formatPct(s.multiYear.grossMargin?.median ?? null),
      quality: s.dimensions.grossMargin ?? "neutral",
      latestValue: s.multiYear.grossMargin?.latestValue,
      median: s.multiYear.grossMargin?.median,
    });
    cards.push({
      label: "FCF Margin",
      hint: multiYearHint(s.multiYear.fcfMargin),
      value: formatPct(s.multiYear.fcfMargin.median),
      quality: s.dimensions.fcfMargin,
      latestValue: s.multiYear.fcfMargin.latestValue,
      median: s.multiYear.fcfMargin.median,
    });
    cards.push({
      label: "Operating Margin",
      hint: trailingFallbackHint(s.multiYear.operatingMargin),
      value: formatPct(
        s.multiYear.operatingMargin?.median ?? fundamentals.operatingMargins,
      ),
      quality: s.dimensions.operatingMargins,
      latestValue: s.multiYear.operatingMargin?.latestValue,
      median: s.multiYear.operatingMargin?.median,
    });
    cards.push({
      label: "Share Count Trend",
      hint: shareCountHint(s.multiYear.shareCountTrend),
      value: formatCagr(s.multiYear.shareCountTrend.median),
      quality: s.dimensions.shareCountTrend,
      latestValue: s.multiYear.shareCountTrend.latestValue,
      median: s.multiYear.shareCountTrend.median,
      isCagr: true,
      higherIsBetter: false, // share count: lower (buybacks) = better
    });
    cards.push({
      label: "Revenue Growth",
      hint: revenueGrowthHint(
        s.multiYear.revenueGrowth,
        fundamentals.revenueGrowth,
      ),
      value: formatCagr(
        s.multiYear.revenueGrowth?.median ?? fundamentals.revenueGrowth,
      ),
      quality: s.dimensions.revenueGrowth,
      latestValue: s.multiYear.revenueGrowth?.latestValue,
      median: s.multiYear.revenueGrowth?.median,
      isCagr: true,
    });
    // Bank / insurer-specific dimensions — neutral on non-bank businesses.
    if (s.multiYear.returnOnEquity) {
      cards.push({
        label: "ROE (multi-year)",
        hint: multiYearHint(s.multiYear.returnOnEquity),
        value: formatPct(s.multiYear.returnOnEquity.median),
        quality: s.dimensions.returnOnEquity ?? "neutral",
        latestValue: s.multiYear.returnOnEquity.latestValue,
        median: s.multiYear.returnOnEquity.median,
      });
    }
    if (s.multiYear.returnOnAssets) {
      cards.push({
        label: "ROA (multi-year)",
        hint: multiYearHint(s.multiYear.returnOnAssets),
        value: formatPct(s.multiYear.returnOnAssets.median),
        quality: s.dimensions.returnOnAssets ?? "neutral",
        latestValue: s.multiYear.returnOnAssets.latestValue,
        median: s.multiYear.returnOnAssets.median,
      });
    }
    if (s.multiYear.bookValuePerShareCagr) {
      cards.push({
        label: "BV/share 5y CAGR",
        hint: bookValueCagrHint(s.multiYear.bookValuePerShareCagr),
        value: formatCagr(s.multiYear.bookValuePerShareCagr.median),
        quality: s.dimensions.bookValuePerShareCagr ?? "neutral",
        latestValue: s.multiYear.bookValuePerShareCagr.latestValue,
        median: s.multiYear.bookValuePerShareCagr.median,
        isCagr: true,
      });
    }
    // REIT-specific dimensions — neutral on non-real-estate businesses.
    if (s.reit?.affoPayoutRatio) {
      cards.push({
        label: "AFFO Payout Ratio",
        hint: affoPayoutHint(s.reit.affoPayoutRatio),
        value: formatPct(s.reit.affoPayoutRatio.value),
        quality: s.dimensions.affoPayoutRatio ?? "neutral",
      });
    }
    if (s.reit?.netDebtToEbitda) {
      cards.push({
        label: "Net Debt / EBITDA",
        hint: netDebtEbitdaHint(s.reit.netDebtToEbitda),
        value: formatMultiple(s.reit.netDebtToEbitda.value),
        quality: s.dimensions.netDebtToEbitda ?? "neutral",
      });
    }
    if (s.multiYear.affoPerShareCagr) {
      cards.push({
        label: "AFFO/share 5y CAGR",
        hint: bookValueCagrHint(s.multiYear.affoPerShareCagr),
        value: formatCagr(s.multiYear.affoPerShareCagr.median),
        quality: s.dimensions.affoPerShareCagr ?? "neutral",
        latestValue: s.multiYear.affoPerShareCagr.latestValue,
        median: s.multiYear.affoPerShareCagr.median,
        isCagr: true,
      });
    }
  }

  // Debt / Equity — scored for product businesses, neutralized for banks
  // and REITs. Always attempted, filtered out below if neutral.
  cards.push({
    label: "Debt / Equity",
    hint:
      analysis?.scorecard_summary.notes?.debtToEquity ??
      "% of equity (trailing)",
    value: formatNumber(fundamentals.debtToEquity),
    quality:
      analysis?.scorecard_summary.dimensions.debtToEquity ??
      scoreMetric("debtToEquity", fundamentals.debtToEquity),
  });

  // Filter: only render dimensions that apply to THIS business type.
  // `neutral` means the dimension isn't a quality signal here — excluded.
  return cards.filter((c) => c.quality !== "neutral");
}

// Business-type-specific description of the scorecard. The detection uses
// the non-neutral dimensions that are exclusive to each type — ROE is only
// scored for balance-sheet businesses; AFFO payout is only scored for REITs.
// Each branch ends with a link to the /about coverage section so the user
// can read what "this type of business" means in Moatboard's framework.
function scorecardDescription(
  summary: Analysis["scorecard_summary"] | undefined,
): React.ReactNode {
  if (!summary) {
    return <span>Analyzing this business&hellip;</span>;
  }
  const dims = summary.dimensions;
  const isBankLike =
    dims.returnOnEquity && dims.returnOnEquity !== "neutral";
  const isReit = dims.affoPayoutRatio && dims.affoPayoutRatio !== "neutral";

  if (isBankLike) {
    return (
      <p>
        This is a <strong>balance-sheet business</strong> — bank, insurer,
        mortgage finance or asset manager. Moatboard judges it on{" "}
        <strong>ROE</strong>, <strong>ROA</strong> and{" "}
        <strong>book value per share growth</strong> (the Buffett /
        Damodaran frame for financial-institution quality), alongside
        operating efficiency, share count and revenue growth. The generic
        ROIC, gross margin, FCF margin and debt/equity dimensions used
        for product businesses aren&apos;t meaningful here: invested
        capital isn&apos;t product capital, revenue is net interest or
        net premium (no COGS), cash flow is dominated by balance-sheet
        activity, and leverage is the business model itself.
      </p>
    );
  }
  if (isReit) {
    return (
      <p>
        This is a <strong>Real Estate Investment Trust</strong>. Moatboard
        judges it on <strong>AFFO payout ratio</strong>,{" "}
        <strong>Net Debt / EBITDA</strong> and{" "}
        <strong>AFFO per share growth</strong> — the industry-standard
        signals for REIT dividend safety, leverage and compounding —
        alongside FCF margin, operating margin, share count and revenue
        growth. ROIC and gross margin don&apos;t apply (revenue is rent,
        no COGS concept); generic debt/equity thresholds don&apos;t
        either (REITs use leverage by design).
      </p>
    );
  }
  return (
    <p>
      This is a <strong>product business</strong>. Moatboard judges it on
      the seven-dimension Buffett / Munger / Terry Smith quality framework:{" "}
      <strong>ROIC</strong>, <strong>gross margin</strong>,{" "}
      <strong>FCF margin</strong>, <strong>operating margin</strong>,{" "}
      <strong>share count trend</strong>, <strong>debt / equity</strong>{" "}
      and <strong>revenue growth</strong>. Multi-year metrics use the
      median across available annual filings and require the worst year
      to also clear the threshold, so a cyclical peak doesn&apos;t earn
      a &ldquo;strong&rdquo; that the trough would reveal as temporary.
    </p>
  );
}

// Additional Signals. Same filter principle as the scored grid: we don't
// render a placeholder for metrics that the data source couldn't load or
// that don't apply to this business type. A dash "—" in a bank's FCF /
// share card would be indistinguishable from a data-load error; better
// to hide the card entirely and let the layout reflow.
function buildAdditionalSignals({
  analysis,
  fundamentals,
  cashYieldContext,
}: {
  analysis: Analysis | null;
  fundamentals: Fundamentals;
  cashYieldContext?: { fcfYield: number; treasuryYield: number } | null;
}): ScoredCard[] {
  const cards: ScoredCard[] = [];

  // FCF Conversion — only renders when we have a computed median.
  const fcfConv = analysis?.scorecard_summary.fcfConversion;
  if (fcfConv && fcfConv.median !== null) {
    cards.push({
      label: "FCF Conversion",
      hint: `FCF / NI · ${fcfConv.yearsUsed}y median`,
      value: formatPct(fcfConv.median),
      quality: "neutral",
    });
  }

  // Cash Yield vs Treasury — context indicator, not a valuation method.
  // Shows FCF yield, 10y Treasury, and the spread. Retired from the
  // valuation toolkit because the raw spread doesn't produce a cheap /
  // expensive reading without own-history context; here it lives as a
  // temperature check alongside Retention Multiple and FCF Conversion.
  if (cashYieldContext) {
    const spreadPp =
      (cashYieldContext.fcfYield - cashYieldContext.treasuryYield) * 100;
    cards.push({
      label: "Cash Yield vs Treasury",
      hint: `FCF yield ${(cashYieldContext.fcfYield * 100).toFixed(2)}% · Treasury ${(cashYieldContext.treasuryYield * 100).toFixed(2)}%`,
      value: `${spreadPp >= 0 ? "+" : ""}${spreadPp.toFixed(2)} pp`,
      quality: "neutral",
    });
  }

  // Retention Multiple — renders when we could compute a ratio (needs
  // market-cap history and positive retained capital).
  const retention = analysis?.scorecard_summary.retentionMultiple;
  if (retention && retention.ratio !== null) {
    cards.push({
      label: "Retention Multiple",
      hint: retentionMultipleHint(retention),
      value: formatRetention(retention.ratio),
      quality: retention.quality ?? "neutral",
    });
  }

  // The rest read from trailing `fundamentals` — hide any that yfinance
  // doesn't report for this business type (banks return null FCF; REITs
  // often return null current ratio; etc.).
  if (fundamentals.returnOnEquity !== null) {
    cards.push({
      label: "ROE",
      hint: "Net income / shareholders' equity",
      value: formatPct(fundamentals.returnOnEquity),
      quality: "neutral",
    });
  }
  if (fundamentals.returnOnAssets !== null) {
    cards.push({
      label: "ROA",
      hint: "Asset productivity",
      value: formatPct(fundamentals.returnOnAssets),
      quality: scoreMetric("returnOnAssets", fundamentals.returnOnAssets),
    });
  }
  if (fundamentals.profitMargins !== null) {
    cards.push({
      label: "Profit Margin",
      hint: "Trailing",
      value: formatPct(fundamentals.profitMargins),
      quality: scoreMetric("profitMargins", fundamentals.profitMargins),
    });
  }
  if (fundamentals.trailingEps !== null) {
    cards.push({
      label: "EPS",
      hint: "Trailing 12m · denominator behind PE",
      value: formatUsdPerShare(fundamentals.trailingEps),
      quality: "neutral",
    });
  }
  if (fundamentals.fcfPerShare !== null) {
    cards.push({
      label: "FCF / share",
      hint: "Trailing 12m · denominator behind P/FCF",
      value: formatUsdPerShare(fundamentals.fcfPerShare),
      quality: "neutral",
    });
  }
  if (fundamentals.freeCashflow !== null) {
    cards.push({
      label: "FCF (abs)",
      hint: "Trailing 12m",
      value: formatLargeUSD(fundamentals.freeCashflow),
      quality: "neutral",
    });
  }
  if (fundamentals.currentRatio !== null) {
    cards.push({
      label: "Current Ratio",
      hint: "Current assets / current liabilities",
      value: formatNumber(fundamentals.currentRatio),
      quality: "neutral",
    });
  }
  if (fundamentals.earningsGrowth !== null) {
    cards.push({
      label: "Earnings Growth",
      hint: "Year over year",
      value: formatPct(fundamentals.earningsGrowth),
      quality: scoreMetric("earningsGrowth", fundamentals.earningsGrowth),
    });
  }

  return cards;
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
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

function formatUsdPerShare(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatCagr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "+";
  return `${sign}${Math.abs(value * 100).toFixed(1)}%/yr`;
}

function multiYearHint(score: MultiYearScore | undefined): string {
  if (!score) return "Regenerate to populate";
  if (score.note) return score.note;
  if (score.yearsUsed === 0) return "No annual data available";
  const medianPart = `${score.yearsUsed}y median`;
  if (score.worstYear !== null) {
    const worstPct = (score.worstYear * 100).toFixed(1);
    return `${medianPart} · worst ${worstPct}%`;
  }
  return medianPart;
}

// Used by dimensions that fall back to a trailing value when multi-year
// data isn't available (operating margin for banks, for example). Keeps
// the hint honest about what the displayed value actually represents.
function trailingFallbackHint(score: MultiYearScore | undefined): string {
  if (!score) return "Regenerate to populate";
  if (score.yearsUsed >= 3) return multiYearHint(score);
  if (score.note) return score.note;
  return "Trailing";
}

function shareCountHint(score: MultiYearScore): string {
  if (score.note) return score.note;
  if (score.yearsUsed < 2) return "Insufficient history";
  return `${score.yearsUsed}y CAGR · negative = buybacks`;
}

function formatRetention(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}

function retentionMultipleHint(
  rm:
    | {
        ratio: number | null;
        yearsUsed: number;
        note?: string;
      }
    | undefined,
): string {
  if (!rm) return "Buffett one-dollar test";
  if (rm.note) return rm.note;
  if (rm.ratio === null) return "Buffett one-dollar test";
  return `$ created per $1 retained · ${rm.yearsUsed}y`;
}

function revenueGrowthHint(
  score: MultiYearScore | undefined,
  trailing: number | null,
): string {
  if (!score) return "Year over year";
  if (score.note) return score.note;
  if (score.yearsUsed >= 3) return `${score.yearsUsed}y CAGR`;
  if (trailing !== null && Number.isFinite(trailing)) return "Year over year";
  return "Year over year";
}

function bookValueCagrHint(score: MultiYearScore | undefined): string {
  if (!score) return "";
  if (score.note) return score.note;
  if (score.yearsUsed < 2) return "Insufficient history";
  return `${score.yearsUsed}y CAGR`;
}

function affoPayoutHint(
  score: { value: number | null; note?: string } | undefined,
): string {
  if (!score) return "Dividend / AFFO (latest)";
  if (score.note) return score.note;
  return "Dividend / AFFO (latest)";
}

function netDebtEbitdaHint(
  score: { value: number | null; note?: string } | undefined,
): string {
  if (!score) return "Net debt / EBITDA (latest)";
  if (score.note) return score.note;
  return "Net debt / EBITDA (latest)";
}

function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}
