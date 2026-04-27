import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { getCostBasis, listTransactions } from "@/lib/positionTransactions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import {
  getCurrentUnderstanding,
  isBusinessUnderstandingStale,
} from "@/lib/businessUnderstanding";
import { getRedFlags } from "@/lib/redFlags";
import {
  computeDecisionContext,
  hasAnyDecisionContext,
} from "@/lib/positionContext";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { ensureQuarterlySnapshots } from "@/lib/snapshotFlow";
import {
  regenerateUnderstandingAction,
  regenerateRedFlagsAction,
} from "@/app/dashboard/analyze/[ticker]/actions";
import {
  buildFilingIndexUrlFromAccession,
  fetchLatestAnnualFiling,
} from "@/lib/secFilings";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type {
  Valuation,
  DcfStoredAssumptions,
  ExcessReturnsStoredAssumptions,
} from "@/lib/valuations";
import type { ValuationGuide } from "@/lib/valuationGuides";
import type { RelativeValuationSnapshot } from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import MoatboardAnalysis from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import ValuationFollowupChat from "@/components/ValuationFollowupChat";
import { listChatTurnsForTicker } from "@/lib/valuationChats";
import FundsHoldingCard from "@/components/FundsHoldingCard";
import { listFundsHoldingTicker } from "@/lib/discoveryFund";
import QualityBadge from "@/components/QualityBadge";
import FollowupChat from "@/components/analysis/FollowupChat";
import TransactionOperationNotesList from "@/components/shared/TransactionOperationNotesList";
import PositionPreCommitment from "@/components/position/PositionPreCommitment";
import AddOperationForm from "@/components/position/AddOperationForm";
import FiftyTwoWeekBar from "@/components/position/FiftyTwoWeekBar";
import InsiderPurchasesCard from "@/components/position/InsiderPurchasesCard";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import RedFlagsList, {
  summarizeFlagsBySeverity,
} from "@/components/shared/RedFlagsList";
import DecisionContextStrip from "@/components/position/DecisionContextStrip";
import NextEarningsCard from "@/components/position/NextEarningsCard";
import PresentationsPanel from "@/components/position/PresentationsPanel";
import PositionTabs, {
  type PositionTabId,
} from "@/components/position/PositionTabs";
import PositionSummary from "@/components/position/PositionSummary";

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

  const [
    { quote, fundamentals },
    costBasis,
    transactions,
    understanding,
    redFlags,
    decisionContext,
    latestAnnualFiling,
  ] = await Promise.all([
    fetchQuoteAndFundamentals(position.ticker),
    getCostBasis(positionId),
    listTransactions(positionId),
    getCurrentUnderstanding(position.ticker),
    getRedFlags(position.ticker),
    computeDecisionContext({ userId: session.user.id, ticker: position.ticker }),
    fetchLatestAnnualFiling(position.ticker).catch(() => null),
  ]);

  const isUnderstandingStale =
    understanding != null &&
    latestAnnualFiling != null &&
    isBusinessUnderstandingStale(understanding, latestAnnualFiling.accession);

  const understandingSourceFiling = understanding?.sources.find(
    (s) => s.type === "10k",
  );

  // All signals for this ticker (new + reviewed) for the Presentaciones
  // tab. Fetched separately from the Promise.all above so a slow query
  // here doesn't block the critical-path data; the position page still
  // renders even if this fails.
  const tickerSignals = await listSignalsForTicker({
    userId: session.user.id,
    ticker: position.ticker,
  }).catch(() => []);

  // Infer the next report type (10-K vs 10-Q) from filing history so
  // the "Próxima presentación" card can label it. Null when the cron
  // hasn't recorded a 10-K yet for this ticker.
  const nextReportType = quote?.nextEarningsDate
    ? await inferNextReportType({
        userId: session.user.id,
        ticker: position.ticker,
        nextEarningsDate: quote.nextEarningsDate,
      }).catch(() => null)
    : null;
  const firstBuyDate = transactions[0]?.transaction_date ?? null;

  // Auto-run analysis and valuation in parallel if not already cached.
  // ensureQuarterlySnapshots also runs here — it checks whether SEC has
  // published a 10-Q/10-K newer than any snapshot we already have for this
  // (user, ticker) and freezes one if so. Silent on failure: the page still
  // renders if SEC is unreachable. Errors are isolated per section so one
  // failure doesn't break the page.
  const [analysisResult, valuationResult] = await Promise.all([
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
    ensureQuarterlySnapshots({
      userId: session.user.id,
      positionId,
      ticker: position.ticker,
    }).catch((err: unknown) => {
      console.warn(
        `Quarterly snapshot check failed for ${position.ticker}:`,
        err,
      );
      return null;
    }),
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

  // Per-ticker chat history. Empty for tickers Joseda hasn't asked
  // about yet. Cheap query (single index on user_id, ticker).
  const valuationChatHistory = await listChatTurnsForTicker({
    userId: session.user.id,
    ticker: position.ticker,
  });

  // Curated funds (Discovery roster) currently holding this business.
  // Pulled in parallel-ish via the same get-then-render server flow;
  // empty array for businesses outside the consensus circle.
  const fundsHolding = await listFundsHoldingTicker(position.ticker);

  const currentPrice = quote?.regularMarketPrice ?? null;
  // Signed offset for the next earnings release; positive = future,
  // negative = past (yfinance estimate not yet updated). Null propagates
  // when yfinance doesn't publish a date.
  const nextEarningsDaysAway = quote?.nextEarningsDate
    ? signedDaysOffset(quote.nextEarningsDate)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; Back to portfolio
          </Link>
          <Link
            href={`/dashboard/position/${positionId}/trajectory`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 shadow-sm hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900"
          >
            Ver evolución &rarr;
          </Link>
        </div>

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
              {/* 52-week range as a visual mini-bar — same navy-neutral
                  language as the valuation distribution bars. Temperature,
                  not a call to action. */}
              {currentPrice !== null &&
                quote?.fiftyTwoWeekLow != null &&
                quote?.fiftyTwoWeekHigh != null && (
                  <FiftyTwoWeekBar
                    current={currentPrice}
                    low={quote.fiftyTwoWeekLow}
                    high={quote.fiftyTwoWeekHigh}
                  />
                )}
            </div>
          </div>
        </header>

        {hasAnyDecisionContext(decisionContext) && (
          <DecisionContextStrip
            ticker={position.ticker}
            context={decisionContext}
          />
        )}

        <PositionTabs
          badges={{
            presentaciones: tickerSignals.filter((s) => s.status === "new")
              .length,
          }}
          panels={buildPanels({
            ticker: position.ticker,
            positionId,
            transactions,
            costBasis,
            currentPrice,
            firstBuyDate,
            preCommitment: position.pre_commitment_md,
            // Format date labels server-side and hand strings to the client
            // component — locale formatting on the client would diverge from
            // the server (UTC vs Madrid TZ) and trigger a hydration mismatch.
            preCommitmentEditedLabel: position.pre_commitment_edited_at
              ? formatLongDateEs(position.pre_commitment_edited_at)
              : null,
            positionCreatedLabel: position.created_at
              ? formatLongDateEs(position.created_at)
              : null,
            understanding,
            quote,
            redFlags,
            analysis,
            analysisError,
            fundamentals,
            cashYieldContext: extractCashYieldContext(valuation),
            valuation,
            valuationError,
            guide,
            outsideFramework: isOutsideFramework({ analysis, valuation }),
            nextEarningsDate: quote?.nextEarningsDate ?? null,
            nextEarningsDaysAway,
            nextReportType,
            tickerSignals,
            isUnderstandingStale,
            latestAnnualFiling,
            understandingSourceFiling: understandingSourceFiling ?? null,
            valuationChatHistory,
            fundsHolding,
          })}
        />
      </main>
    </div>
  );
}

// Build the four tab panels server-side. Pre-rendered JSX is passed to the
// client tab shell; only the active panel mounts in the DOM at a time.
function buildPanels(args: {
  ticker: string;
  positionId: number;
  transactions: import("@/lib/positionTransactions").PositionTransaction[];
  costBasis: import("@/lib/positionTransactions").CostBasis;
  currentPrice: number | null;
  firstBuyDate: string | null;
  preCommitment: string | null;
  preCommitmentEditedLabel: string | null;
  positionCreatedLabel: string | null;
  understanding: import("@/lib/businessUnderstanding").BusinessUnderstanding | null;
  quote: import("@/lib/financial").Quote | null;
  redFlags: import("@/lib/redFlags").QualitativeRedFlags | null;
  analysis: Analysis | null;
  analysisError: string | null;
  fundamentals: import("@/lib/financial").Fundamentals | null;
  cashYieldContext: { fcfYield: number; treasuryYield: number } | null;
  valuation: Valuation | null;
  valuationError: string | null;
  guide: ValuationGuide | null;
  outsideFramework: boolean;
  nextEarningsDate: string | null;
  nextEarningsDaysAway: number | null;
  nextReportType: "10-K" | "10-Q" | null;
  tickerSignals: import("@/lib/reviewSignals").ReviewSignal[];
  isUnderstandingStale: boolean;
  latestAnnualFiling: import("@/lib/secFilings").LatestAnnualFiling | null;
  understandingSourceFiling:
    | import("@/lib/businessUnderstanding").BusinessUnderstandingSource
    | null;
  valuationChatHistory: import("@/lib/valuationChats").ValuationChatTurn[];
  fundsHolding: import("@/lib/discoveryFund").FundHoldingTicker[];
}): Record<PositionTabId, React.ReactNode> {
  const {
    ticker,
    positionId,
    transactions,
    costBasis,
    currentPrice,
    firstBuyDate,
    preCommitment,
    preCommitmentEditedLabel,
    positionCreatedLabel,
    understanding,
    quote,
    redFlags,
    analysis,
    analysisError,
    fundamentals,
    cashYieldContext,
    valuation,
    valuationError,
    guide,
    outsideFramework,
    nextEarningsDate,
    nextEarningsDaysAway,
    nextReportType,
    tickerSignals,
    isUnderstandingStale,
    latestAnnualFiling,
    understandingSourceFiling,
    valuationChatHistory,
    fundsHolding,
  } = args;

  const razonamiento = (
    <div className="space-y-6">
    <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      {nextEarningsDate && nextEarningsDaysAway !== null && (
        <div className="mb-6">
          <NextEarningsCard
            earningsDate={nextEarningsDate}
            daysAway={nextEarningsDaysAway}
            reportType={nextReportType}
          />
        </div>
      )}

      <PositionPreCommitment
        positionId={positionId}
        text={preCommitment}
        editedLabel={preCommitmentEditedLabel}
        createdLabel={positionCreatedLabel}
      />

      <div className="mt-6 border-t border-navy-100 pt-5">
        <PositionSummary
          shares={costBasis.shares}
          avgCost={costBasis.avg_cost_per_share}
          invested={costBasis.invested}
          currentPrice={currentPrice}
          ownedSince={firstBuyDate}
        />
      </div>

      <div className="mt-6 border-t border-navy-100 pt-5">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-navy-500">
          Operations &amp; notes
        </h3>
        <p className="mb-4 text-xs text-navy-500">
          Each operation carries a short note explaining why.
        </p>
        <div className="mb-4">
          <AddOperationForm
            positionId={positionId}
            currentPrice={currentPrice}
          />
        </div>
        {/* Reverse for display only — newest first reads better in a log
            view. listTransactions stays chronological because getCostBasis
            and any future running-total logic depend on that order. */}
        <TransactionOperationNotesList
          transactions={[...transactions].reverse()}
        />
      </div>
    </section>

    <FundsHoldingCard ticker={ticker} funds={fundsHolding} />
    </div>
  );

  const negocio = (
    <div className="space-y-6">
      {isUnderstandingStale && latestAnnualFiling && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Nuevo {latestAnnualFiling.form} disponible
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Publicado el {formatLongDateEs(latestAnnualFiling.filingDate)}
                {latestAnnualFiling.reportDate
                  ? ` (FY ${latestAnnualFiling.reportDate})`
                  : ""}
                . La explicación actual se generó con el filing anterior.
              </p>
            </div>
            <form action={regenerateUnderstandingAction.bind(null, ticker)}>
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
              >
                Regenerar con nuevo {latestAnnualFiling.form}
              </button>
            </form>
          </div>
        </section>
      )}

      {understanding && (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-navy-950">
                Entiende el negocio
              </h2>
              <p className="mt-1 text-xs text-navy-500">
                Versión {understanding.version} · generada el{" "}
                {formatLongDateEs(understanding.generated_at)}
              </p>
              {understandingSourceFiling && (
                <p className="mt-1 text-xs text-navy-500">
                  Basado en{" "}
                  <a
                    href={understandingSourceFiling.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-navy-700"
                  >
                    {understandingSourceFiling.label}
                  </a>
                </p>
              )}
            </div>
            <form action={regenerateUnderstandingAction.bind(null, ticker)}>
              <button
                type="submit"
                className="text-sm font-medium text-navy-600 hover:text-navy-900"
              >
                Regenerar
              </button>
            </form>
          </div>
          <BusinessUnderstandingView understanding={understanding} />
          <div className="mt-6">
            <FollowupChat ticker={ticker} />
          </div>
        </section>
      )}

      {redFlags && (
        <RedFlagsAccordion
          ticker={ticker}
          flags={redFlags.flags}
          generatedAt={redFlags.generated_at}
          last10kAccession={redFlags.last_10k_accession}
          last10kPeriodEnd={redFlags.last_10k_period_end}
        />
      )}
    </div>
  );

  const calidad = outsideFramework ? (
    <UnsupportedBusinessNotice />
  ) : (
    <>
      <MoatboardAnalysis
        positionId={positionId}
        ticker={ticker}
        analysis={analysis}
        fundamentals={fundamentals}
        cashYieldContext={cashYieldContext}
        loadError={analysisError}
      />
      <InsiderPurchasesCard ticker={ticker} />
    </>
  );

  const valoracion = outsideFramework ? (
    <UnsupportedBusinessNotice />
  ) : (
    <>
      <ValuationSection
        positionId={positionId}
        ticker={ticker}
        valuation={valuation}
        guide={guide}
        loadError={valuationError}
      />
      {valuation && (
        <ValuationFollowupChat
          positionId={positionId}
          ticker={ticker}
          initialHistory={valuationChatHistory}
        />
      )}
    </>
  );

  const presentaciones = (
    <PresentationsPanel
      positionId={positionId}
      signals={tickerSignals}
      nextEarningsDate={nextEarningsDate}
      nextEarningsDaysAway={nextEarningsDaysAway}
      nextReportType={nextReportType}
    />
  );

  return { razonamiento, negocio, calidad, valoracion, presentaciones };
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

// Signed day offset from now to the given date. Positive = future,
// negative = past. Used for the next earnings card which needs both
// directions (yfinance estimates sometimes land in the past when the
// release date is reshuffled and the cached estimate lags).
function signedDaysOffset(value: string | Date): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatLongDateEs(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

// Red flags accordion. Expanded by default when any serious/watch flag is
// present; collapsed when only info or empty so the page stays calm.
function RedFlagsAccordion({
  ticker,
  flags,
  generatedAt,
  last10kAccession,
  last10kPeriodEnd,
}: {
  ticker: string;
  flags: import("@/lib/redFlags").RedFlag[];
  generatedAt: string;
  last10kAccession: string | null;
  last10kPeriodEnd: string | null;
}) {
  const counts = summarizeFlagsBySeverity(flags);
  const hasUrgent = counts.serious > 0 || counts.watch > 0;
  const summaryParts: string[] = [];
  if (counts.serious > 0) summaryParts.push(`${counts.serious} grave`);
  if (counts.watch > 0) summaryParts.push(`${counts.watch} vigilar`);
  if (counts.info > 0) summaryParts.push(`${counts.info} info`);
  const summaryLabel =
    summaryParts.length > 0
      ? `Red flags · ${summaryParts.join(", ")}`
      : "Red flags · sin alertas conocidas";

  const filingUrl = last10kAccession
    ? buildFilingIndexUrlFromAccession(last10kAccession)
    : null;
  const filingLabel = last10kPeriodEnd
    ? `10-K FY ${last10kPeriodEnd}`
    : last10kAccession
      ? `10-K accession ${last10kAccession}`
      : null;

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white shadow-sm">
      <details open={hasUrgent} className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 text-sm font-semibold text-navy-900 hover:text-navy-700">
          <span>{summaryLabel}</span>
          <span className="text-navy-400 transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="border-t border-navy-100 px-6 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex-1 text-xs text-navy-500">
              <p>Generadas el {formatLongDateEs(generatedAt)}</p>
              {filingLabel && (
                <p className="mt-0.5">
                  Basado en{" "}
                  {filingUrl ? (
                    <a
                      href={filingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-navy-700"
                    >
                      {filingLabel}
                    </a>
                  ) : (
                    filingLabel
                  )}
                </p>
              )}
              {!last10kAccession && (
                <p className="mt-0.5 text-amber-700">
                  Sin 10-K reciente disponible — fallback a conocimiento general.
                </p>
              )}
            </div>
            <form action={regenerateRedFlagsAction.bind(null, ticker)}>
              <button
                type="submit"
                className="text-sm font-medium text-navy-600 hover:text-navy-900"
              >
                Regenerar
              </button>
            </form>
          </div>
          <RedFlagsList flags={flags} />
        </div>
      </details>
    </section>
  );
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
    </section>
  );
}
