import type { ReviewSignal } from "@/lib/reviewSignals";
import type { CronRun } from "@/lib/cronRuns";
import SignalCard from "@/components/SignalCard";

// Dashboard inbox for review signals. Groups by ticker and renders a
// heartbeat line ("última verificación …") so the "0 signals = calm"
// reading is honest — if the cron hasn't run in > 36h we warn.
//
// Server component: no state, no handlers. The inner SignalCard is the
// only client piece (needs `useTransition` + local expand state).
export default function SignalsInbox({
  signals,
  positionIdByTicker,
  cronRun,
  heartbeatThresholdHours = 36,
}: {
  signals: ReviewSignal[];
  // Maps ticker → live position id when the user holds the ticker. null
  // for watchlist tickers (no position yet). Used by SignalCard to link
  // straight into /trajectory when applicable.
  positionIdByTicker: Record<string, number | null>;
  cronRun: CronRun | null;
  heartbeatThresholdHours?: number;
}) {
  const grouped = groupByTicker(signals);
  const heartbeat = describeHeartbeat(cronRun, heartbeatThresholdHours);

  return (
    <section className="mb-8">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-navy-500">
          Señales
        </h2>
        <span className={`text-[11px] ${heartbeat.tone}`}>
          {heartbeat.text}
        </span>
      </header>

      {signals.length === 0 ? (
        <EmptyState heartbeat={heartbeat} />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ ticker, rows }) => (
            <div key={ticker}>
              {grouped.length > 1 && (
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-navy-500">
                  {ticker}{" "}
                  <span className="ml-1 text-navy-400">
                    · {rows.length}{" "}
                    {rows.length === 1 ? "señal" : "señales"}
                  </span>
                </h3>
              )}
              <div className="space-y-3">
                {rows.map((s) => (
                  <SignalCard
                    key={s.id}
                    signal={s}
                    positionId={positionIdByTicker[ticker] ?? null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({
  heartbeat,
}: {
  heartbeat: { ok: boolean };
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/40 px-5 py-4 text-sm text-navy-600">
      {heartbeat.ok ? (
        <>
          <p className="font-medium text-navy-800">
            0 señales pendientes.
          </p>
          <p className="mt-1 text-xs text-navy-500">
            Estado de calma. Nada accionable desde SEC EDGAR para tus tickers
            activos.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium text-navy-800">0 señales pendientes.</p>
          <p className="mt-1 text-xs text-amber-700">
            El sistema no ha verificado recientemente — el &ldquo;0 señales&rdquo;
            puede no ser fiable.
          </p>
        </>
      )}
    </div>
  );
}

function groupByTicker(
  signals: ReviewSignal[],
): { ticker: string; rows: ReviewSignal[] }[] {
  const map = new Map<string, ReviewSignal[]>();
  for (const s of signals) {
    const arr = map.get(s.ticker) ?? [];
    arr.push(s);
    map.set(s.ticker, arr);
  }
  return Array.from(map.entries()).map(([ticker, rows]) => ({ ticker, rows }));
}

// Returns a descriptive line for the heartbeat and a tone class for the
// text. The "stale" threshold is 36h by default — below that the pipeline
// is considered healthy. Above, the empty-inbox message changes to
// explicitly warn that silence may be stale.
function describeHeartbeat(
  run: CronRun | null,
  thresholdHours: number,
): { text: string; tone: string; ok: boolean } {
  if (!run) {
    return {
      text: "Sin ejecuciones previas del cron de señales",
      tone: "text-amber-700",
      ok: false,
    };
  }
  const startedMs = new Date(run.started_at).getTime();
  const ageMs = Date.now() - startedMs;
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageText = humaniseAge(ageHours);
  const ok = run.ok && ageHours < thresholdHours;

  if (!run.ok) {
    return {
      text: `Último intento hace ${ageText} · falló`,
      tone: "text-red-700",
      ok: false,
    };
  }
  if (ageHours >= thresholdHours) {
    return {
      text: `Última verificación hace ${ageText}`,
      tone: "text-amber-700",
      ok: false,
    };
  }
  return {
    text: `Última verificación hace ${ageText}`,
    tone: "text-navy-500",
    ok,
  };
}

function humaniseAge(hours: number): string {
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} min`;
  }
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "día" : "días"}`;
}
