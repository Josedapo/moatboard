import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { getThesisByPositionId } from "@/lib/theses";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type {
  Valuation,
  DcfStoredAssumptions,
  ExcessReturnsStoredAssumptions,
} from "@/lib/valuations";
import type { ValuationGuide } from "@/lib/valuationGuides";
import type { RelativeValuationSnapshot } from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import BusinessDescription from "@/components/BusinessDescription";
import MoatboardAnalysis from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import ThesisSection from "@/components/Thesis";
import QualityBadge from "@/components/QualityBadge";

export const metadata = {
  title: "Position",
};

export default async function PositionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const positionId = Number(id);
  if (!Number.isFinite(positionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) return null;

  const position = await getPositionById(positionId, session.user.id);
  if (!position) notFound();

  const { quote, fundamentals } = await fetchQuoteAndFundamentals(position.ticker);

  // Auto-run analysis and valuation in parallel if not already cached.
  // Errors are isolated per section so one failure doesn't break the page.
  const [analysisResult, valuationResult, thesis] = await Promise.all([
    ensureAnalysis(positionId, position.ticker)
      .then((a) => ({ ok: true as const, data: a }))
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "Failed to compute analysis",
      })),
    ensureValuation(positionId, position.ticker, quote, fundamentals)
      .then((v) => ({ ok: true as const, data: v }))
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "Failed to compute valuation",
      })),
    getThesisByPositionId(positionId),
  ]);

  const analysis: Analysis | null = analysisResult.ok ? analysisResult.data : null;
  const analysisError = analysisResult.ok ? null : analysisResult.error;
  const valuation: Valuation | null = valuationResult.ok
    ? valuationResult.data
    : null;
  const valuationError = valuationResult.ok ? null : valuationResult.error;

  // Fetch the AI-generated valuation guide AFTER the valuation is known —
  // we need the relative snapshot to tell the guide whether P/B is available
  // for this ticker. The call is cached per ticker (TTL 365d), so only the
  // first visit to a new ticker pays the AI cost. Failure is silent: the
  // guide block is simply not rendered.
  let guide: ValuationGuide | null = null;
  if (valuation) {
    const snapshot = (
      valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
    ).relative_valuation;
    // Each tool's availability mirrors the UI render condition exactly —
    // if the DistributionTool would return null, strip that tool from the
    // guide prompt so the AI can't recommend a vara the UI won't render.
    const isDistributionReady = (s: RelativeValuationSnapshot["pe"] | undefined) =>
      !!s &&
      s.current !== null &&
      s.median !== null &&
      s.q1 !== null &&
      s.q3 !== null &&
      s.min !== null &&
      s.max !== null;
    const peAvailable = isDistributionReady(snapshot?.pe);
    const pfcfAvailable = isDistributionReady(snapshot?.fcf_yield);
    const pbAvailable = isDistributionReady(snapshot?.pb);
    guide = await ensureValuationGuide(
      position.ticker,
      quote,
      fundamentals,
      {
        pe: peAvailable,
        pfcf: pfcfAvailable,
        pb: pbAvailable,
      },
    );
  }

  const purchasePrice = Number(position.purchase_price);
  const currentPrice = quote?.regularMarketPrice ?? null;
  const changePct =
    currentPrice !== null
      ? ((currentPrice - purchasePrice) / purchasePrice) * 100
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-block text-sm text-navy-600 hover:text-navy-900"
        >
          &larr; Back to portfolio
        </Link>

        {/* Header */}
        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              {/* Top line: ticker · company name · Quality badge.
                  Quality sits right next to the name because it's the
                  primary Moatboard judgement about the business — the
                  verdict the user should read first. */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
                  {position.ticker}
                </span>
                {quote?.longName && (
                  <h1 className="text-2xl font-bold text-navy-950">
                    {quote.longName}
                  </h1>
                )}
                {analysis && !isOutsideFramework({ analysis, valuation }) && (
                  <QualityBadge tier={analysis.tier} size="sm" />
                )}
              </div>

              {/* Secondary line: sector / industry tags. Context, not judgement. */}
              {quote?.sector && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                    {quote.sector}
                  </span>
                  {quote.industry && (
                    <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                      {quote.industry}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="sm:pl-6 sm:border-l sm:border-navy-100 sm:text-right">
              <div className="text-4xl font-bold tracking-tight text-navy-950">
                {currentPrice !== null ? `$${currentPrice.toFixed(2)}` : "—"}
              </div>
              {changePct !== null && (
                <div
                  className={`mt-1 text-sm font-semibold ${
                    changePct >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}% since purchase
                </div>
              )}
              <div className="mt-2 text-xs text-navy-500">
                Bought at ${purchasePrice.toFixed(2)} · {position.purchase_date}
              </div>
              {/* 52-week range as a single discreet line — temperature, not
                  valuation. Deliberately text-only to avoid giving it more
                  visual weight than it deserves. */}
              {currentPrice !== null &&
                quote?.fiftyTwoWeekLow != null &&
                quote?.fiftyTwoWeekHigh != null && (
                  <div className="mt-1 text-xs text-navy-500">
                    52w ${quote.fiftyTwoWeekLow.toFixed(2)} – $
                    {quote.fiftyTwoWeekHigh.toFixed(2)} ·{" "}
                    {formatRangePosition(
                      currentPrice,
                      quote.fiftyTwoWeekLow,
                      quote.fiftyTwoWeekHigh,
                    )}
                  </div>
                )}
            </div>
          </div>
        </header>

        {/* About the business — separate card so the long-form description
            gets its own horizontal real estate instead of squeezing the
            header. */}
        {quote?.longBusinessSummary && (
          <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
              About the business
            </h2>
            <BusinessDescription text={quote.longBusinessSummary} />
          </section>
        )}

        {isOutsideFramework({ analysis, valuation }) ? (
          <UnsupportedBusinessNotice />
        ) : (
          <>
            {/* Moatboard Business Analysis */}
            <MoatboardAnalysis
              positionId={positionId}
              ticker={position.ticker}
              analysis={analysis}
              fundamentals={fundamentals}
              cashYieldContext={extractCashYieldContext(valuation)}
              loadError={analysisError}
            />

            {/* Valuation */}
            <ValuationSection
              positionId={positionId}
              valuation={valuation}
              guide={guide}
              loadError={valuationError}
            />

            {/* Your Thesis */}
            <ThesisSection
              positionId={positionId}
              verdict={analysis?.tier ?? null}
              thesis={thesis}
            />
          </>
        )}
      </main>
    </div>
  );
}

// Where today's price sits inside the 52-week range, phrased as a single
// descriptive clause. No color, no bar, no verdict — just the plain fact.
function formatRangePosition(
  current: number,
  low: number,
  high: number,
): string {
  if (current >= high) return "at 52w high";
  if (current <= low) return "at 52w low";
  const pctBelowHigh = ((high - current) / high) * 100;
  if (pctBelowHigh < 1) return "near 52w high";
  return `${pctBelowHigh.toFixed(0)}% below high`;
}

// A business falls outside Moatboard's framework when the scorecard
// couldn't score at least 5 applicable dimensions (strong + acceptable +
// weak, excluding neutrals). The threshold of 5 is set by the minimum
// applicable count for the most constrained business type Moatboard
// supports: banks have 6 dimensions (Op Margin, Share Count, Revenue
// Growth, ROE, ROA, BV/share CAGR); REITs have 7; product businesses
// have 7. Under 5 means the framework didn't fit — this catches recent
// IPOs with <3y of fundamental history (many multi-year scorers return
// neutral), business models whose industry classification doesn't fit
// any branch cleanly, and companies with broken yfinance data. Showing
// a Poor / Good tier with so few dimensions anchors the user on a
// verdict the product can't back. Independent of valuation method: a
// DCF that ran successfully on one year of data doesn't rescue a
// scorecard that has nothing to score.
function isOutsideFramework({
  analysis,
  valuation,
}: {
  analysis: Analysis | null;
  valuation: Valuation | null;
}): boolean {
  if (!analysis || !valuation) return true;
  const s = analysis.scorecard_summary;
  const applicable = s.strong + s.acceptable + s.weak;

  // (1) Too few applicable dimensions — catches recent IPOs whose yfinance
  // data doesn't span enough years, businesses whose industry doesn't
  // route into any supported framework, and broken data.
  if (applicable < 5) return true;

  // (2) Pre-commercial businesses: no absolute valuation method applied
  // (owner earnings / book value couldn't produce an IV → multiples
  // fallback) AND operating margin fell below −50% in the worst reported
  // year. That combination signals the business hasn't demonstrated a
  // functioning commercial operation — quality analysis isn't meaningful
  // for a not-yet-business. A normal unprofitable-but-functioning
  // company (Reddit-style, -10 to -20% op margin) survives this filter
  // and correctly shows as Poor rather than as unanalyzable.
  const opMarginWorst = s.multiYear.operatingMargin?.worstYear;
  if (
    valuation.method === "ai_multiples" &&
    opMarginWorst !== null &&
    opMarginWorst !== undefined &&
    opMarginWorst < -0.5
  ) {
    return true;
  }

  return false;
}

// Extract the inputs the "Cash Yield" reference card needs: current FCF
// yield (from the relative-valuation snapshot) and spot 10y Treasury
// (stored under different names across valuation methods). Null when any
// input is missing — the Additional Signals card hides itself.
function extractCashYieldContext(
  valuation: Valuation | null,
): { fcfYield: number; treasuryYield: number } | null {
  if (!valuation) return null;
  const snapshot = (
    valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
  ).relative_valuation;
  const fcfYield = snapshot?.fcf_yield.current ?? null;
  if (fcfYield === null || fcfYield <= 0) return null;
  let treasuryYield: number | null = null;
  if (valuation.method === "dcf" || valuation.method === "affo_dcf") {
    treasuryYield =
      (valuation.assumptions as DcfStoredAssumptions).treasury_current_pct ??
      null;
  } else if (valuation.method === "excess_returns") {
    treasuryYield =
      (valuation.assumptions as ExcessReturnsStoredAssumptions)
        .risk_free_rate ?? null;
  }
  if (treasuryYield === null) return null;
  return { fcfYield, treasuryYield };
}

function UnsupportedBusinessNotice() {
  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-8 shadow-sm">
      <h2 className="mb-3 text-xl font-bold text-navy-950">
        Moatboard can&apos;t analyze this business
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-navy-700">
        This company doesn&apos;t fit the business-quality framework Moatboard
        uses. Common cases include pre-revenue growth companies, specialty
        finance that falls outside standard bank or product categories, deep
        cyclicals at trough earnings, crypto-native companies, and businesses
        with fewer than three years of reporting history.
      </p>
      <p className="mb-5 text-sm leading-relaxed text-navy-700">
        Rather than produce a verdict the framework can&apos;t support,
        Moatboard surfaces this explicitly. If you believe this ticker should
        be analyzable, it&apos;s often a ticker-classification issue that
        will be addressed over time.
      </p>
      <Link
        href="/about#coverage"
        className="inline-flex items-center text-sm font-medium text-navy-900 hover:text-navy-700"
      >
        See what Moatboard covers &rarr;
      </Link>
    </section>
  );
}
