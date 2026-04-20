import type { ReviewSignal } from "@/lib/reviewSignals";
import NextEarningsCard from "@/components/position/NextEarningsCard";
import SignalCard from "@/components/SignalCard";

// The Presentaciones tab: next earnings date + timeline of SEC signals
// (new + reviewed) for this single ticker. Reviewed signals render
// muted with a ✓ so the history reads as context; pending ones retain
// their severity coloring.
//
// No grouping — already per-ticker — just a single vertical list
// ordered by event_date desc (query is the source of truth).

export default function PresentationsPanel({
  positionId,
  signals,
  nextEarningsDate,
  nextEarningsDaysAway,
  nextReportType = null,
}: {
  // null when the ticker lives in the watchlist (no ficha to link to).
  // SignalCard accepts null already — the Evolución link is suppressed.
  positionId: number | null;
  signals: ReviewSignal[];
  nextEarningsDate: string | null;
  nextEarningsDaysAway: number | null;
  nextReportType?: "10-K" | "10-Q" | null;
}) {
  const newCount = signals.filter((s) => s.status === "new").length;
  const reviewedCount = signals.filter(
    (s) => s.status === "reviewed",
  ).length;

  return (
    <section className="space-y-6">
      {nextEarningsDate && nextEarningsDaysAway !== null && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
            Próxima presentación
          </h3>
          <NextEarningsCard
            earningsDate={nextEarningsDate}
            daysAway={nextEarningsDaysAway}
            reportType={nextReportType}
          />
        </div>
      )}

      <div>
        {signals.length > 0 && (newCount > 0 || reviewedCount > 0) && (
          <div className="mb-3 flex justify-end">
            <span className="text-[11px] text-navy-500">
              {newCount > 0 && (
                <span className="text-amber-700">
                  {newCount} {newCount === 1 ? "pendiente" : "pendientes"}
                </span>
              )}
              {newCount > 0 && reviewedCount > 0 && " · "}
              {reviewedCount > 0 && (
                <span>
                  {reviewedCount} revisada{reviewedCount === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </div>
        )}

        {signals.length === 0 ? (
          <div className="rounded-xl border border-navy-100 bg-navy-50/40 px-5 py-4 text-sm text-navy-600">
            <p className="font-medium text-navy-800">
              Sin señales para este ticker.
            </p>
            <p className="mt-1 text-xs text-navy-500">
              Aquí aparecerán los 10-Q, 10-K y 8-K materiales cuando la SEC
              los publique.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {signals.map((s) => (
              <SignalCard
                key={s.id}
                signal={s}
                positionId={positionId}
                mode={s.status}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
