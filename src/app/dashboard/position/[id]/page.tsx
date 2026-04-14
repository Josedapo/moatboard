import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { getThesisByPositionId } from "@/lib/theses";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { classifyMarginOfSafety } from "@/lib/valuation";
import type { MoatboardAnalysis as Analysis } from "@/lib/moatboardAnalyses";
import type { Valuation } from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import BusinessDescription from "@/components/BusinessDescription";
import MoatboardAnalysis from "@/components/MoatboardAnalysis";
import ValuationSection from "@/components/Valuation";
import ThesisSection from "@/components/Thesis";
import QualityBadge from "@/components/QualityBadge";
import MarginOfSafetyBadge from "@/components/MarginOfSafetyBadge";

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
        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
                  {position.ticker}
                </span>
                {quote?.longName && (
                  <h1 className="text-2xl font-bold text-navy-950">
                    {quote.longName}
                  </h1>
                )}
              </div>

              {/* Two-badge layout: Quality + Valuation */}
              {(analysis || valuation) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {analysis && <QualityBadge tier={analysis.tier} size="sm" />}
                  {valuation && (
                    <MarginOfSafetyBadge
                      tier={
                        classifyMarginOfSafety(
                          Number(valuation.intrinsic_value),
                          Number(valuation.current_price),
                        ).tier
                      }
                      size="sm"
                    />
                  )}
                </div>
              )}

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
            <div className="text-right sm:pl-6 sm:border-l sm:border-navy-100">
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
            </div>
          </div>

          {quote?.longBusinessSummary && (
            <div className="mt-6 border-t border-navy-100 pt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
                About the business
              </h2>
              <BusinessDescription text={quote.longBusinessSummary} />
            </div>
          )}
        </header>

        {/* Moatboard Business Analysis */}
        <MoatboardAnalysis
          positionId={positionId}
          ticker={position.ticker}
          analysis={analysis}
          fundamentals={fundamentals}
          loadError={analysisError}
        />

        {/* Valuation */}
        <ValuationSection
          positionId={positionId}
          ticker={position.ticker}
          valuation={valuation}
          fundamentals={fundamentals}
          loadError={valuationError}
        />

        {/* Your Thesis */}
        <ThesisSection
          positionId={positionId}
          verdict={analysis?.tier ?? null}
          thesis={thesis}
        />
      </main>
    </div>
  );
}
