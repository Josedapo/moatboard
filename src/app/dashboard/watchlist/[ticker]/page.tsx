import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTickerState } from "@/lib/tickerStates";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { ensureDraftPosition } from "@/lib/positions";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { deriveLiveImpliedReturn } from "@/lib/impliedReturn";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import {
  listSignalsForTicker,
  inferNextReportType,
} from "@/lib/reviewSignals";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import { getRedFlags } from "@/lib/redFlags";
import type {
  ImpliedReturnStoredAssumptions,
  RelativeValuationSnapshot,
  Valuation,
} from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import PositionTabs from "@/components/position/PositionTabs";
import PresentationsPanel from "@/components/position/PresentationsPanel";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import RedFlagsList from "@/components/shared/RedFlagsList";
import MoatboardAnalysisView from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import FundsHoldingCard from "@/components/FundsHoldingCard";
import { listFundsHoldingTicker } from "@/lib/discoveryFund";
import { reanalyzeTickerAction } from "../../actions";

// Dedicated per-ticker view for watchlist entries. Mirrors the live
// position ficha's tabbed layout (Overview / Negocio / Calidad /
// Valoración / Señales) so there's no visual break when the user
// moves between a watchlisted ticker and one they own. Since there's
// no position yet, the first tab is relabelled "Observación" and
// shows the watchlist-specific context (why it's watched, when to
// revisit, next earnings) instead of portfolio KPIs and operations.

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props) {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} · Watchlist` };
}

export default async function WatchlistTickerPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const state = await getTickerState({
    userId: session.user.id,
    ticker,
  });
  // Only watchlist entries render here. Redirect to history for
  // discarded, or 404 when the user has no record.
  if (!state || state.status !== "watchlist") notFound();

  // Get-or-create a draft position for this watchlisted ticker so
  // ensureAnalysis / ensureValuation work against a real position_id.
  // Drafts have no transactions and stay hidden from the Dashboard.
  const draftPosition = await ensureDraftPosition(session.user.id, ticker);

  const [
    { quote, fundamentals },
    signals,
    understanding,
    redFlags,
    fundsHolding,
  ] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    listSignalsForTicker({ userId: session.user.id, ticker }),
    getCurrentUnderstanding(ticker),
    getRedFlags(ticker),
    listFundsHoldingTicker(ticker),
  ]);

  // Badge count for the Señales tab: just the "new" signals for this
  // ticker, computed from the array we already have so no extra query.
  const newSignalsCount = signals.filter((s) => s.status === "new").length;

  let analysis = null;
  let analysisError: string | null = null;
  try {
    analysis = await ensureAnalysis(draftPosition.id, ticker);
  } catch (err) {
    analysisError =
      err instanceof Error ? err.message : "Failed to load scorecard";
  }

  let persistedValuation: Valuation | null = null;
  let valuationError: string | null = null;
  try {
    persistedValuation = await ensureValuation(
      draftPosition.id,
      ticker,
      quote,
      fundamentals,
    );
  } catch (err) {
    valuationError =
      err instanceof Error ? err.message : "Failed to compute valuation";
  }

  // Live-recompute the implied-return verdict against today's market cap
  // (same pattern as the live position page). Pure math, no AI, no DB.
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

  let valuationGuide = null;
  if (valuation) {
    const snapshot = (
      valuation.assumptions as { relative_valuation?: RelativeValuationSnapshot }
    ).relative_valuation;
    const ready = (s: RelativeValuationSnapshot["pe"] | undefined) =>
      !!s &&
      s.current !== null &&
      s.median !== null &&
      s.q1 !== null &&
      s.q3 !== null &&
      s.min !== null &&
      s.max !== null;
    valuationGuide = await ensureValuationGuide(ticker, quote, fundamentals, {
      pe: ready(snapshot?.pe),
      pfcf: ready(snapshot?.fcf_yield),
      pb: ready(snapshot?.pb),
    }).catch(() => null);
  }

  const nextEarningsDaysAway = quote?.nextEarningsDate
    ? daysUntil(quote.nextEarningsDate)
    : null;
  const nextReportType = quote?.nextEarningsDate
    ? await inferNextReportType({
        userId: session.user.id,
        ticker,
        nextEarningsDate: quote.nextEarningsDate,
      }).catch(() => null)
    : null;

  // ─── Tab panels ───

  const observacion = (
    <div className="space-y-6">
      {(state.reason_md || quote?.nextEarningsDate) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {state.reason_md && (
            <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
                Por qué está en watchlist
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-navy-800">
                {state.reason_md}
              </p>
            </section>
          )}

          {quote?.nextEarningsDate && (
            <section
              className={`rounded-2xl border border-navy-100 bg-white p-6 shadow-sm ${
                state.reason_md ? "lg:col-span-1" : "lg:col-span-3"
              }`}
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
                Próxima presentación
              </div>
              <div className="text-sm text-navy-800">
                <span className="tabular-nums">
                  {formatDateLong(quote.nextEarningsDate)}
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

      <section className="rounded-2xl border border-dashed border-navy-200 bg-navy-50/30 p-6">
        <p className="text-sm text-navy-700">
          Este ticker está en observación. Si la tesis cambia —
          valoración cae a un rango razonable, una señal SEC aclara una
          duda, la trimestral confirma una mejora — pasa por{" "}
          <span className="font-medium text-navy-900">Re-analizar</span>{" "}
          arriba para iniciar el wizard completo de decisión.
        </p>
      </section>
    </div>
  );

  const negocio = (
    <div className="space-y-6">
      {understanding ? (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-navy-950">
              Entiende el negocio
            </h2>
            <p className="mt-1 text-xs text-navy-500">
              Versión {understanding.version} · generada el{" "}
              {formatDateLong(understanding.generated_at)}
            </p>
          </div>
          <BusinessUnderstandingView understanding={understanding} />
        </section>
      ) : (
        <EmptyHint
          text="Aún no hay resumen del negocio en caché. Pulsa Re-analizar arriba para generarlo."
        />
      )}

      {redFlags ? (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-navy-950">
              Red flags cualitativas
            </h2>
            <p className="mt-1 text-xs text-navy-500">
              Generadas el {formatDateLong(redFlags.generated_at)}
            </p>
          </div>
          <RedFlagsList flags={redFlags.flags} />
        </section>
      ) : (
        <EmptyHint text="Sin red flags cualitativas en caché todavía." />
      )}
    </div>
  );

  const calidad = (
    <MoatboardAnalysisView
      positionId={draftPosition.id}
      ticker={ticker}
      analysis={analysis}
      fundamentals={fundamentals}
      loadError={analysisError}
      hideRegenerate
    />
  );

  const valoracion = (
    <>
      <ValuationSection
        positionId={draftPosition.id}
        ticker={ticker}
        valuation={valuation}
        guide={valuationGuide}
        loadError={valuationError}
        hideRegenerate
      />
    </>
  );

  const presentaciones = (
    <PresentationsPanel
      positionId={null}
      signals={signals}
      nextEarningsDate={quote?.nextEarningsDate ?? null}
      nextEarningsDaysAway={nextEarningsDaysAway}
      nextReportType={nextReportType}
    />
  );

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/dashboard/watchlist"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; Volver a watchlist
          </Link>
          <form action={reanalyzeTickerAction}>
            <input type="hidden" name="ticker" value={ticker} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 shadow-sm hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900"
            >
              Re-analizar &rarr;
            </button>
          </form>
        </div>

        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
              {ticker}
            </span>
            {quote?.longName && (
              <h1 className="text-2xl font-bold text-navy-950">
                {quote.longName}
              </h1>
            )}
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
              Watchlist
            </span>
            {quote?.regularMarketPrice !== null &&
              quote?.regularMarketPrice !== undefined && (
                <span className="ml-auto text-xl font-semibold tabular-nums text-navy-900">
                  ${quote.regularMarketPrice.toFixed(2)}
                </span>
              )}
          </div>
          {(quote?.sector || quote?.industry) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {quote?.sector && (
                <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                  {quote.sector}
                </span>
              )}
              {quote?.industry && (
                <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-700">
                  {quote.industry}
                </span>
              )}
            </div>
          )}
        </header>

        <PositionTabs
          panels={{
            razonamiento: observacion,
            negocio,
            calidad,
            valoracion,
            presentaciones,
          }}
          badges={{ presentaciones: newSignalsCount }}
        />
      </main>
    </div>
  );
}

// ─── Helpers ───

function daysUntil(value: string | Date): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
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

function formatDateLong(iso: string | Date): string {
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return typeof iso === "string" ? iso.slice(0, 10) : String(iso);
  }
}

function EmptyHint({ text }: { text: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-navy-200 bg-navy-50/30 p-6 text-center">
      <p className="text-sm text-navy-600">{text}</p>
    </section>
  );
}
