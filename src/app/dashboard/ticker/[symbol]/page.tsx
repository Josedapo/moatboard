// Universal ticker ficha — single canonical surface for any company,
// regardless of the user's relationship with it (owned / watchlisted /
// neither).
//
// Post-2026-04-28: cartera derives from positions with net>0 (binary)
// and watchlist is an orthogonal toggle. The previous "discarded" /
// "outside_circle" states were eliminated.
//
// Tabs (Negocio · Calidad · Valoración · Presentaciones) render
// identically regardless of relationship. The Overview tab is the only
// piece that branches: owned → operations log + cost basis +
// Compromiso de salida; not owned → próxima presentación + funds
// holding card.

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { isOnWatchlist as queryIsOnWatchlist } from "@/lib/watchlistEntries";
import { getPositionById, ensureDraftPosition } from "@/lib/positions";
import { getCostBasis, listTransactions } from "@/lib/positionTransactions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import { getRedFlags } from "@/lib/redFlags";
import { getMoatAssessment } from "@/lib/moats";
import { getPreAnalysis } from "@/lib/discoveryPreAnalysis";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import {
  ensureAnalysis,
  ensureValuation,
  computeImpliedReturnEphemeral,
} from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { ensureQuarterlySnapshots } from "@/lib/snapshotFlow";
import { buildFilingIndexUrlFromAccession } from "@/lib/secFilings";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type {
  Valuation,
  DcfStoredAssumptions,
  ExcessReturnsStoredAssumptions,
  ImpliedReturnStoredAssumptions,
  RelativeValuationSnapshot,
} from "@/lib/valuations";
import type { ValuationGuide } from "@/lib/valuationGuides";
import { deriveLiveImpliedReturn } from "@/lib/impliedReturn";
import DashboardNav from "@/components/DashboardNav";
import WatchlistStarToggle from "@/components/WatchlistStarToggle";
import MoatboardAnalysis from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import FundsHoldingCard from "@/components/FundsHoldingCard";
import { listFundsHoldingTicker } from "@/lib/discoveryFund";
import QualityBadge from "@/components/QualityBadge";
import TransactionOperationNotesList from "@/components/shared/TransactionOperationNotesList";
import PositionPreCommitment from "@/components/position/PositionPreCommitment";
import AddOperationForm from "@/components/position/AddOperationForm";
import FiftyTwoWeekBar from "@/components/position/FiftyTwoWeekBar";
import InsiderPurchasesCard from "@/components/position/InsiderPurchasesCard";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import RedFlagsList, {
  summarizeFlagsBySeverity,
} from "@/components/shared/RedFlagsList";
import NextEarningsCard from "@/components/position/NextEarningsCard";
import PresentationsPanel from "@/components/position/PresentationsPanel";
import PositionTabs, {
  type PositionTabId,
} from "@/components/position/PositionTabs";
import PositionSummary from "@/components/position/PositionSummary";
import {
  analyzeBusinessAction,
  analyzeQualityAction,
  analyzeValuationAction,
} from "@/app/dashboard/analyzeActions";
import { SubmitButton, PendingOverlay } from "@/components/AsyncPending";

export const metadata = { title: "Ficha" };

type Props = { params: Promise<{ symbol: string }> };

// View mode = derived from positions only. Binary. Watchlist is a
// separate orthogonal flag (`isWatchlisted`).
type ViewMode = "in_portfolio" | "discovery";

export default async function TickerFichaPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const userId = session.user.id;

  const { symbol } = await params;
  const ticker = (await getCanonicalTicker(symbol.toUpperCase())).toUpperCase();

  // Resolve user's relationship with this ticker. Owned = lived
  // position (net>0 derives from transactions). Watchlist is an
  // independent tag.
  const [isWatchlisted, positionRow] = await Promise.all([
    queryIsOnWatchlist({ userId, ticker }),
    findPositionForCanonical(userId, ticker),
  ]);

  // Drafts (positions without transactions) persist as the anchor for
  // cached analyses, so the mere existence of `positionRow` doesn't
  // imply ownership. Only a position with at least one transaction is
  // "lived".
  const positionHasTx =
    positionRow !== null
      ? ((await sql`
          SELECT 1 FROM position_transactions WHERE position_id = ${positionRow.id} LIMIT 1
        `) as Array<unknown>).length > 0
      : false;

  const mode: ViewMode = positionHasTx ? "in_portfolio" : "discovery";

  // Resolve the position id we'll feed into ensure*/ regenerate actions.
  // When the user has no position yet but has cached analysis interest,
  // we ensure a draft so subsequent analyze runs share the same row.
  let positionId: number | null = null;
  if (positionRow) {
    positionId = positionRow.id;
  } else if (isWatchlisted) {
    const draft = await ensureDraftPosition(userId, ticker);
    positionId = draft.id;
  }

  // Position-level fields (only meaningful when there's an actual
  // position behind the ficha — Discovery puro has none).
  const positionMeta = positionId
    ? await getPositionById(positionId, userId)
    : null;

  // Load everything in parallel. Some queries are conditional on having
  // a position id; the no-position branches just skip the query and
  // resolve to empty.
  const [
    { quote, fundamentals },
    understanding,
    redFlags,
    moatAssessment,
    preAnalysis,
    fundsHolding,
    transactions,
    costBasis,
    tickerSignals,
  ] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    getCurrentUnderstanding(ticker),
    getRedFlags(ticker),
    getMoatAssessment(ticker),
    getPreAnalysis(ticker),
    listFundsHoldingTicker(ticker),
    positionId ? listTransactions(positionId) : Promise.resolve([]),
    positionId ? getCostBasis(positionId) : Promise.resolve(null),
    listSignalsForTicker({ userId, ticker }).catch(() => []),
  ]);

  const understandingSourceFiling = understanding?.sources.find(
    (s) => s.type === "10k",
  );

  const nextReportType = quote?.nextEarningsDate
    ? await inferNextReportType({
        userId,
        ticker,
        nextEarningsDate: quote.nextEarningsDate,
      }).catch(() => null)
    : null;

  // Auto-run analysis + valuation only when there's a position. For
  // Discovery puro we read from shared cache and skip the writes
  // entirely (see deriveAnalysisFromShared / Valuation tab fallback
  // below).
  let analysisResult:
    | { ok: true; data: Analysis }
    | { ok: false; error: string }
    | null = null;
  let valuationResult:
    | { ok: true; data: Valuation | null }
    | { ok: false; error: string }
    | null = null;
  if (positionId) {
    const [a, v] = await Promise.all([
      ensureAnalysis(positionId, ticker)
        .then((data) => ({ ok: true as const, data }))
        .catch((err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : "Failed to compute analysis",
        })),
      ensureValuation(positionId, ticker, quote, fundamentals)
        .then((data) => ({ ok: true as const, data }))
        .catch((err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : "Failed to compute valuation",
        })),
      ensureQuarterlySnapshots({ userId, positionId, ticker }).catch(() => null),
    ]);
    analysisResult = a;
    valuationResult = v;
  }

  // Per-position analysis takes precedence; fall back to a synthetic
  // shape derived from the shared cache so the Calidad tab renders the
  // same scorecard + moat for every user as soon as anybody analyzes
  // the ticker.
  let analysis: Analysis | null = analysisResult?.ok ? analysisResult.data : null;
  const analysisError = analysisResult && !analysisResult.ok ? analysisResult.error : null;
  if (!analysis && preAnalysis?.status === "covered") {
    analysis = deriveAnalysisFromShared(preAnalysis, moatAssessment);
  }

  const persistedValuation: Valuation | null =
    valuationResult?.ok ? valuationResult.data : null;
  const valuationError =
    valuationResult && !valuationResult.ok ? valuationResult.error : null;

  // Live-recompute implied-return verdict against today's market cap.
  const valuation: Valuation | null =
    persistedValuation &&
    persistedValuation.method === "implied_return" &&
    quote?.marketCap
      ? {
          ...persistedValuation,
          assumptions: deriveLiveImpliedReturn(
            persistedValuation.assumptions as ImpliedReturnStoredAssumptions,
            quote.marketCap,
          ),
        }
      : persistedValuation;

  let guide: ValuationGuide | null = null;
  if (valuation) {
    const snapshot = (
      valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
    ).relative_valuation;
    const isReady = (s: RelativeValuationSnapshot["pe"] | undefined) =>
      !!s &&
      s.current !== null &&
      s.median !== null &&
      s.q1 !== null &&
      s.q3 !== null &&
      s.min !== null &&
      s.max !== null;
    guide = await ensureValuationGuide(ticker, quote, fundamentals, {
      pe: isReady(snapshot?.pe),
      pfcf: isReady(snapshot?.fcf_yield),
      pb: isReady(snapshot?.pb),
    }).catch(() => null);
  }

  const currentPrice = quote?.regularMarketPrice ?? null;
  const nextEarningsDaysAway = quote?.nextEarningsDate
    ? signedDaysOffset(quote.nextEarningsDate)
    : null;
  const firstBuyDate = transactions[0]?.transaction_date ?? null;
  const newSignalsCount = tickerSignals.filter((s) => s.status === "new").length;
  const outsideFramework = isOutsideFramework({ analysis, valuation });

  // Whether the user has actually analyzed this ticker themselves.
  // Drives the valuation render branch (per-user row exists vs ephemeral
  // pure-compute fallback).
  const hasUserOwnValuation = valuationResult?.ok && !!persistedValuation;

  // Render-only valuation for users without a per-position row (Discovery
  // puro / closed positions). Pure compute over shared inputs (SEC, quote,
  // valuation guide, peer median). Errors are silent — fall back to the
  // "not analyzed" placeholder.
  const ephemeralValuation: Valuation | null = hasUserOwnValuation
    ? null
    : await computeImpliedReturnEphemeral(
        ticker,
        quote,
        fundamentals,
        analysis?.tier,
      ).catch(() => null);

  // ─── Tab panels ───

  const overview =
    mode === "in_portfolio" && positionId && costBasis
      ? renderPortfolioOverview({
          ticker,
          positionId,
          transactions,
          costBasis,
          currentPrice,
          firstBuyDate,
          preCommitment: positionMeta?.pre_commitment_md ?? null,
          preCommitmentEditedLabel: positionMeta?.pre_commitment_edited_at
            ? formatLongDateEs(positionMeta.pre_commitment_edited_at)
            : null,
          positionCreatedLabel: positionMeta?.created_at
            ? formatLongDateEs(positionMeta.created_at)
            : null,
          fundsHolding,
          quote,
          nextEarningsDaysAway,
          nextReportType,
        })
      : renderSimpleOverview({
          ticker,
          mode,
          reasonMd: null,
          quote,
          nextEarningsDaysAway,
          nextReportType,
          fundsHolding,
        });

  const negocio = renderNegocioTab({
    ticker,
    understanding,
    redFlags,
    understandingSourceFiling: understandingSourceFiling ?? null,
  });

  const calidad = outsideFramework ? (
    <UnsupportedBusinessNotice />
  ) : analysis ? (
    <>
      <MoatboardAnalysis
        ticker={ticker}
        analysis={analysis}
        fundamentals={fundamentals}
        cashYieldContext={extractCashYieldContext(valuation)}
        loadError={analysisError}
      />
      {/* Insider purchases card is private SEC info, not state-dependent */}
      <InsiderPurchasesCard ticker={ticker} />
    </>
  ) : (
    <NotAnalyzedBlock
      title="Calidad sin analizar"
      body="Nadie ha analizado todavía la calidad de este negocio. Pulsa Analizar calidad para correr el scorecard + el moat sobre el último 10-K. Suele tardar 15-30 segundos. Se cachea para todos los usuarios."
      formAction={analyzeQualityAction.bind(null, ticker)}
      actionLabel="Analizar calidad"
      pendingMessage="Moatboard está puntuando las dimensiones y leyendo el moat…"
    />
  );

  const valoracion = outsideFramework ? (
    <UnsupportedBusinessNotice />
  ) : hasUserOwnValuation ? (
    <ValuationSection
      positionId={positionId!}
      ticker={ticker}
      valuation={valuation}
      guide={guide}
      loadError={valuationError}
    />
  ) : ephemeralValuation ? (
    <ValuationSection
      positionId={positionId ?? -1}
      ticker={ticker}
      valuation={ephemeralValuation}
      guide={null}
      loadError={null}
      ephemeral={true}
    />
  ) : (
    <NotAnalyzedBlock
      title="Valoración aún no computada"
      body="Pulsa Analizar valoración para calcular el retorno implícito (FCF Yield + crecimiento sostenible + Δ múltiplo) y verificarlo contra los dos checks (atractivo + no-desastre). Suele tardar 15-30 segundos."
      formAction={analyzeValuationAction.bind(null, ticker)}
      actionLabel="Analizar valoración"
      pendingMessage="Moatboard está computando el implied return…"
    />
  );

  const presentaciones = (
    <PresentationsPanel
      positionId={positionId}
      signals={tickerSignals}
      nextEarningsDate={quote?.nextEarningsDate ?? null}
      nextEarningsDaysAway={nextEarningsDaysAway}
      nextReportType={nextReportType}
    />
  );

  const panels: Record<PositionTabId, React.ReactNode> = {
    razonamiento: overview,
    negocio,
    calidad,
    valoracion,
    presentaciones,
  };

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={backHref(mode)}
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; {backLabel(mode)}
          </Link>
          <div className="flex items-center gap-2">
            {positionId && mode === "in_portfolio" && (
              <Link
                href={`/dashboard/position/${positionId}/trajectory`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 shadow-sm hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900"
              >
                Ver evolución &rarr;
              </Link>
            )}
          </div>
        </div>

        {/* Header */}
        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
                  {ticker}
                </span>
                {quote?.longName && (
                  <h1 className="text-2xl font-bold text-navy-950">
                    {quote.longName}
                  </h1>
                )}
                {analysis && !outsideFramework && (
                  <QualityBadge tier={analysis.tier} size="sm" />
                )}
                <span className="inline-flex items-center gap-1.5">
                  <WatchlistStarToggle
                    ticker={ticker}
                    isOnWatchlist={isWatchlisted}
                  />
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      isWatchlisted
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-navy-100 bg-navy-50 text-navy-400"
                    }`}
                  >
                    Watchlist
                  </span>
                </span>
              </div>

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

        <PositionTabs
          panels={panels}
          badges={{ presentaciones: newSignalsCount }}
        />
      </main>
    </div>
  );
}

// ─── Helpers ───

// Find any position (live, draft, or closed) whose ticker resolves to
// the requested canonical. Mirrors the dispatcher's old SQL but returns
// the row.
async function findPositionForCanonical(
  userId: string | number,
  canonicalTicker: string,
): Promise<{ id: number; ticker: string } | null> {
  const rows = (await sql`
    SELECT p.id, p.ticker
      FROM positions p
      LEFT JOIN ticker_aliases ta ON ta.ticker = p.ticker
     WHERE p.user_id = ${userId}
       AND COALESCE(ta.canonical_ticker, p.ticker) = ${canonicalTicker}
     ORDER BY p.id DESC
     LIMIT 1
  `) as { id: number; ticker: string }[];
  return rows[0] ?? null;
}

// Construct a synthetic Analysis-shaped object from the shared
// `discovery_pre_analyses` row + canonical moat assessment. Verdict
// reason is left empty — the per-user analysis carries the prose.
function deriveAnalysisFromShared(
  pre: NonNullable<Awaited<ReturnType<typeof getPreAnalysis>>>,
  moat: Awaited<ReturnType<typeof getMoatAssessment>>,
): Analysis | null {
  if (
    pre.tier === null ||
    pre.scorecard_summary === null ||
    pre.moat_strength === null ||
    pre.moat_archetype === null
  ) {
    return null;
  }
  return {
    id: -1,
    position_id: -1,
    tier: pre.tier,
    verdict_reason: moat?.reasoning ?? "",
    scorecard_summary: pre.scorecard_summary,
    moat_strength: pre.moat_strength,
    moat_archetype: pre.moat_archetype,
    generated_at: pre.evaluated_at,
  };
}

function isOutsideFramework({
  analysis,
  valuation,
}: {
  analysis: Analysis | null;
  valuation: Valuation | null;
}): boolean {
  if (!analysis) return false; // null analysis = "not analyzed yet", not "outside framework"
  const s = analysis.scorecard_summary;
  const applicable = s.strong + s.acceptable + s.weak;
  if (applicable < 5) return true;
  if (!valuation) return false;
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

function relativeDaysLabel(days: number): string {
  if (days < 0) {
    const d = Math.abs(days);
    return `hace ${d} ${d === 1 ? "día" : "días"}`;
  }
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days < 31) return `en ${days} días`;
  const months = Math.round(days / 30);
  return `en ${months} ${months === 1 ? "mes" : "meses"}`;
}

function backHref(mode: ViewMode): string {
  if (mode === "in_portfolio") return "/dashboard";
  return "/dashboard/discovery";
}

function backLabel(mode: ViewMode): string {
  if (mode === "in_portfolio") return "Volver a la cartera";
  return "Volver a Discovery";
}

// ─── Overview variants ───

function renderPortfolioOverview(args: {
  ticker: string;
  positionId: number;
  transactions: Awaited<ReturnType<typeof listTransactions>>;
  costBasis: Awaited<ReturnType<typeof getCostBasis>>;
  currentPrice: number | null;
  firstBuyDate: string | null;
  preCommitment: string | null;
  preCommitmentEditedLabel: string | null;
  positionCreatedLabel: string | null;
  fundsHolding: Awaited<ReturnType<typeof listFundsHoldingTicker>>;
  quote: Awaited<ReturnType<typeof fetchQuoteAndFundamentals>>["quote"];
  nextEarningsDaysAway: number | null;
  nextReportType: "10-K" | "10-Q" | null;
}): React.ReactNode {
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
    fundsHolding,
    quote,
    nextEarningsDaysAway,
    nextReportType,
  } = args;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        {quote?.nextEarningsDate && nextEarningsDaysAway !== null && (
          <div className="mb-6">
            <NextEarningsCard
              earningsDate={quote.nextEarningsDate}
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
          <TransactionOperationNotesList
            transactions={[...transactions].reverse()}
          />
        </div>
      </section>

      <FundsHoldingCard ticker={ticker} funds={fundsHolding} />
    </div>
  );
}

// Used by watchlist / discarded / discovery — same skeleton, only the
// reason block varies (hidden for discovery puro since there's no
// ticker_states row).
function renderSimpleOverview(args: {
  ticker: string;
  mode: ViewMode;
  reasonMd: string | null;
  quote: Awaited<ReturnType<typeof fetchQuoteAndFundamentals>>["quote"];
  nextEarningsDaysAway: number | null;
  nextReportType: "10-K" | "10-Q" | null;
  fundsHolding: Awaited<ReturnType<typeof listFundsHoldingTicker>>;
}): React.ReactNode {
  const {
    ticker,
    mode,
    reasonMd,
    quote,
    nextEarningsDaysAway,
    nextReportType,
    fundsHolding,
  } = args;

  // Post-2026-04-28: watchlist no longer carries a reason field.
  // reasonMd will always be null; the variable kept for legacy
  // signatures but the block never renders.
  void mode;
  const reasonTitle: string | null = null;
  const hasReason = reasonMd && reasonTitle;
  const hasNext = !!quote?.nextEarningsDate;

  return (
    <div className="space-y-6">
      {(hasReason || hasNext) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {hasReason && (
            <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
                {reasonTitle}
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-navy-800">
                {reasonMd}
              </p>
            </section>
          )}

          {hasNext && (
            <section
              className={`rounded-2xl border border-navy-100 bg-white p-6 shadow-sm ${
                hasReason ? "lg:col-span-1" : "lg:col-span-3"
              }`}
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
                Próxima presentación
              </div>
              <div className="text-sm text-navy-800">
                <span className="tabular-nums">
                  {formatLongDateEs(quote!.nextEarningsDate!)}
                </span>
                {nextEarningsDaysAway !== null && (
                  <span className="ml-2 text-navy-500">
                    {relativeDaysLabel(nextEarningsDaysAway)}
                  </span>
                )}
                {nextReportType && (
                  <span className="ml-2 inline-block rounded border border-navy-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-navy-600">
                    {nextReportType}
                  </span>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <FundsHoldingCard ticker={ticker} funds={fundsHolding} />
    </div>
  );
}

// ─── Negocio tab ───

function renderNegocioTab(args: {
  ticker: string;
  understanding: Awaited<ReturnType<typeof getCurrentUnderstanding>>;
  redFlags: Awaited<ReturnType<typeof getRedFlags>>;
  understandingSourceFiling:
    | NonNullable<
        Awaited<ReturnType<typeof getCurrentUnderstanding>>
      >["sources"][number]
    | null;
}): React.ReactNode {
  const { ticker, understanding, redFlags, understandingSourceFiling } = args;
  // Single combined stub when EITHER piece is missing. analyzeBusinessAction
  // does one SEC fetch + parallel Claude calls for the missing pieces, vs
  // separate buttons that would download the 10-K twice.
  const needsAnalysis = !understanding || !redFlags;
  const stubCopy = stubCopyFor(understanding, redFlags);

  return (
    <div className="space-y-6">
      {needsAnalysis && (
        <NotAnalyzedBlock
          title={stubCopy.title}
          body={stubCopy.body}
          formAction={analyzeBusinessAction.bind(null, ticker)}
          actionLabel={stubCopy.actionLabel}
          pendingMessage="Moatboard está leyendo el 10-K…"
        />
      )}

      {understanding && (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="mb-4">
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
          <BusinessUnderstandingView understanding={understanding} />
        </section>
      )}

      {redFlags && (
        <RedFlagsAccordion
          flags={redFlags.flags}
          generatedAt={redFlags.generated_at}
          last10kAccession={redFlags.last_10k_accession}
          last10kPeriodEnd={redFlags.last_10k_period_end}
        />
      )}
    </div>
  );
}

// Smart copy for the combined Negocio stub. The button always runs the
// same idempotent action (analyzeBusinessAction); the framing changes
// to match what's actually missing.
function stubCopyFor(
  understanding: Awaited<ReturnType<typeof getCurrentUnderstanding>>,
  redFlags: Awaited<ReturnType<typeof getRedFlags>>,
): { title: string; body: string; actionLabel: string } {
  if (!understanding && !redFlags) {
    return {
      title: "Negocio sin analizar",
      body: "Nadie ha analizado todavía qué hace este negocio ni ha extraído sus red flags. Pulsa Analizar negocio para descargar el último 10-K una sola vez y producir en paralelo el resumen en castellano (5 secciones + 5-7 preguntas) y las red flags cualitativas agrupadas por severidad. Suele tardar 15-40 segundos. Se cachea para todos los usuarios.",
      actionLabel: "Analizar negocio",
    };
  }
  if (!understanding) {
    return {
      title: "Falta el resumen del negocio",
      body: "Las red flags ya están extraídas, pero falta el resumen en castellano. Pulsa Completar análisis para descargar el 10-K y generar el resumen.",
      actionLabel: "Completar análisis",
    };
  }
  // !redFlags
  return {
    title: "Faltan red flags",
    body: "El resumen del negocio ya está, pero faltan las red flags cualitativas (Item 1A del 10-K). Pulsa Completar análisis para extraerlas.",
    actionLabel: "Completar análisis",
  };
}

function RedFlagsAccordion({
  flags,
  generatedAt,
  last10kAccession,
  last10kPeriodEnd,
}: {
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
          <div className="mb-3 text-xs text-navy-500">
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
          <RedFlagsList flags={flags} />
        </div>
      </details>
    </section>
  );
}

function NotAnalyzedBlock({
  title,
  body,
  formAction,
  actionLabel = "Analizar",
  pendingMessage,
}: {
  title: string;
  body: string;
  formAction: (formData: FormData) => void | Promise<void>;
  actionLabel?: string;
  pendingMessage?: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-navy-200 bg-navy-50/30 p-6">
      <h2 className="mb-2 text-base font-semibold text-navy-900">{title}</h2>
      <p className="mb-4 text-sm leading-relaxed text-navy-700">{body}</p>
      <form action={formAction}>
        <PendingOverlay
          message={pendingMessage ?? "Moatboard está pensando."}
        />
        <SubmitButton
          pendingLabel="Analizando…"
          className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 shadow-sm hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900 disabled:opacity-60"
        >
          {actionLabel} &rarr;
        </SubmitButton>
      </form>
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
        Moatboard surfaces this explicitly.
      </p>
    </section>
  );
}
