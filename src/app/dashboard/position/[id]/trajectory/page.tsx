import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { listTransactions } from "@/lib/positionTransactions";
import { listSnapshotsForPosition } from "@/lib/snapshots";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { ensureValuationGuide } from "@/lib/valuationGuides";
import { getMoatAssessment } from "@/lib/moats";
import { listLatestMoatValidationsForPosition } from "@/lib/moatValidations";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import type { RelativeValuationSnapshot } from "@/lib/valuations";
import DashboardNav from "@/components/DashboardNav";
import TrajectoryExplorer from "@/components/position/TrajectoryExplorer";
import type { TransactionType } from "@/lib/positionTransactions";
import type { FundamentalsSnapshot } from "@/lib/snapshotDiff";

export const metadata = {
  title: "Trajectory",
};

// Sentinel id for the synthetic "hoy" entry. Real snapshots always have
// positive ids from Postgres, so -1 is safe as a marker.
const TODAY_ID = -1;

export default async function TrajectoryPage({
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

  // Historical snapshots + transaction log for labels, plus any moat
  // validations the user has already run (indexed by from_snapshot_id so
  // the selector can hydrate the MoatValidationPanel without a fresh AI
  // call each time a snapshot is selected).
  const [snapshots, transactions, moatValidations] = await Promise.all([
    listSnapshotsForPosition(positionId),
    listTransactions(positionId),
    listLatestMoatValidationsForPosition({
      userId: session.user.id,
      positionId,
    }),
  ]);

  // Lookup map: transaction_id → type, so each intermediate row can show
  // "Compra / Ampliación / Recorte / Venta" instead of a generic label.
  const transactionTypes: Record<number, TransactionType> = {};
  for (const t of transactions) transactionTypes[t.id] = t.type;

  // Identify the "compra" anchor — the snapshot attached to the first buy
  // transaction. One per position in normal flow; fallback to the oldest
  // snapshot when for some reason (legacy data) the buy snapshot is missing.
  const buyTx = transactions.find((t) => t.type === "buy");
  const buySnapshot = buyTx
    ? snapshots.find((s) => s.transaction_id === buyTx.id)
    : null;
  const buyId = buySnapshot?.id ?? snapshots[0]?.id ?? null;

  // Build the "hoy" pseudo-snapshot by running the same ensure-pattern the
  // position page uses: analysis + valuation compute against today's
  // fundamentals, moat reads from the per-ticker cache (no AI call here —
  // regeneration is user-driven via a dedicated button in a later
  // iteration). All four fetches are allowed to fail silently; if analysis
  // or valuation fail we just omit the "hoy" row rather than break the page.
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(
    position.ticker,
  );

  const [analysisResult, valuationResult, moat, understanding] =
    await Promise.all([
      ensureAnalysis(positionId, position.ticker).catch(() => null),
      ensureValuation(
        positionId,
        position.ticker,
        quote,
        fundamentals,
      ).catch(() => null),
      getMoatAssessment(position.ticker).catch(() => null),
      getCurrentUnderstanding(position.ticker).catch(() => null),
    ]);

  // Valuation guide depends on which relative tools are computable for this
  // ticker (P/B only renders when book value stays positive). Mirror the
  // availability test the live position page uses so the synthetic "hoy"
  // guide doesn't recommend a tool we can't render downstream.
  const guideToday = await loadGuideForToday({
    ticker: position.ticker,
    quote,
    fundamentals,
    valuation: valuationResult,
  });

  const todaySnapshot = buildTodaySnapshot({
    userId: Number(session.user.id),
    positionId,
    ticker: position.ticker,
    currentPrice: quote?.regularMarketPrice ?? null,
    analysis: analysisResult,
    valuation: valuationResult,
    valuationGuide: guideToday,
    moat,
    understandingVersion: understanding?.version ?? null,
  });

  // Merge synthetic + persisted, keep oldest → newest ordering (snapshots
  // already sorted asc by `taken_at`; `hoy` is always the newest).
  const entries: FundamentalsSnapshot[] = todaySnapshot
    ? [...snapshots, todaySnapshot]
    : snapshots;

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Link
          href={`/dashboard/position/${positionId}`}
          className="mb-6 inline-block text-sm text-navy-600 hover:text-navy-900"
        >
          &larr; Volver a la ficha
        </Link>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-navy-950">
            Trayectoria · {position.ticker}
          </h1>
          <p className="mt-1 text-sm text-navy-600">
            Cada snapshot es una foto inmutable del momento. Compara dos para
            ver qué cambió.
          </p>
        </header>

        {entries.length === 0 ? (
          <section className="rounded-2xl border border-navy-100 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-navy-900">
              Aún no hay snapshots
            </h2>
            <p className="mt-2 text-sm text-navy-600">
              Los snapshots se generan automáticamente en cada compra o
              ampliación, y al publicarse un 10-Q o 10-K nuevo.
            </p>
          </section>
        ) : (
          <TrajectoryExplorer
            positionId={positionId}
            ticker={position.ticker}
            snapshots={entries}
            transactionTypes={transactionTypes}
            todayId={todaySnapshot ? TODAY_ID : null}
            buyId={buyId}
            moatValidations={moatValidations}
            preCommitment={{
              text: position.pre_commitment_md,
              editedAt: position.pre_commitment_edited_at,
            }}
          />
        )}
      </main>
    </div>
  );
}

// Synthesise the "hoy" row as a FundamentalsSnapshot shape. This is never
// persisted — the sentinel id=-1 marks it ephemeral so the trajectory
// selector can treat it differently (label "HOY", default Hasta anchor).
// The moat block is copied from the ticker-level cache; it's the same moat
// the position page renders today, which is the honest answer until the
// user triggers a fresh evaluation.
function buildTodaySnapshot({
  userId,
  positionId,
  ticker,
  currentPrice,
  analysis,
  valuation,
  valuationGuide,
  moat,
  understandingVersion,
}: {
  userId: number;
  positionId: number;
  ticker: string;
  currentPrice: number | null;
  analysis: import("@/lib/moatboardAnalyses").MoatboardAnalysis | null;
  valuation: import("@/lib/valuations").Valuation | null;
  valuationGuide: import("@/lib/valuationGuides").ValuationGuide | null;
  moat: import("@/lib/moats").MoatAssessment | null;
  understandingVersion: number | null;
}): FundamentalsSnapshot | null {
  if (!analysis || !valuation) return null;

  const now = new Date().toISOString();

  return {
    id: TODAY_ID,
    user_id: userId,
    ticker: ticker.toUpperCase(),
    position_id: positionId,
    transaction_id: null,
    // The client renders this entry as "HOY" via the `todayId` prop, so the
    // generic trigger value is never shown. `transaction` is the harmless
    // default that satisfies the type.
    trigger: "transaction",
    sec_filing_accession: null,
    taken_at: now,
    current_price: currentPrice != null ? String(currentPrice) : null,
    tier: analysis.tier,
    scorecard_summary: analysis.scorecard_summary,
    multi_year: null,
    moat: moat
      ? {
          strength: moat.strength,
          archetype: moat.archetype,
          reasoning: moat.reasoning,
        }
      : null,
    valuation_method: valuation.method,
    valuation_intrinsic_value: valuation.intrinsic_value ?? null,
    valuation_intrinsic_value_low: valuation.intrinsic_value_low ?? null,
    valuation_intrinsic_value_high: valuation.intrinsic_value_high ?? null,
    valuation_margin_of_safety_pct: valuation.margin_of_safety_pct ?? null,
    // Carrying the assumptions unlocks the relative-valuation snapshot
    // (pe / fcf_yield / pb current + distribution) for the trajectory's
    // valuation comparison. The shape is a discriminated union, widened
    // here to `unknown` which is how snapshots store it anyway.
    valuation_assumptions: valuation.assumptions ?? null,
    valuation_guide: valuationGuide,
    business_understanding_version: understandingVersion,
    thesis_snapshot: null,
    created_at: now,
  };
}

// Loads today's valuation guide via the same ensure-pattern the position
// page uses. Safe to call even when the valuation couldn't be computed —
// in that case we return null and the trajectory falls back to whatever
// guide (if any) the earlier snapshot carries.
async function loadGuideForToday({
  ticker,
  quote,
  fundamentals,
  valuation,
}: {
  ticker: string;
  quote: import("@/lib/financial").Quote | null;
  fundamentals: import("@/lib/financial").Fundamentals | null;
  valuation: import("@/lib/valuations").Valuation | null;
}): Promise<import("@/lib/valuationGuides").ValuationGuide | null> {
  if (!valuation) return null;
  const assumptions = valuation.assumptions as {
    relative_valuation?: RelativeValuationSnapshot;
  };
  const snapshot = assumptions?.relative_valuation;
  const isDistributionReady = (
    s: RelativeValuationSnapshot["pe"] | undefined,
  ) =>
    !!s &&
    s.current !== null &&
    s.median !== null &&
    s.q1 !== null &&
    s.q3 !== null &&
    s.min !== null &&
    s.max !== null;
  try {
    return await ensureValuationGuide(ticker, quote, fundamentals, {
      pe: isDistributionReady(snapshot?.pe),
      pfcf: isDistributionReady(snapshot?.fcf_yield),
      pb: isDistributionReady(snapshot?.pb),
    });
  } catch {
    return null;
  }
}
