// Heartbeat banner above the Discovery leaderboard. Shows the agent's
// progress on the pre-tiering job: how many tickers are covered, how
// many are pending, when the last cron ran, what came out of it. The
// goal isn't a dashboard — it's making the agent visible enough that
// the user trusts the tier chips below.

import Link from "next/link";
import type { PreAnalysisStats } from "@/lib/preAnalysisStats";
import type { CronRun } from "@/lib/cronRuns";

function formatRelative(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(ms / 60_000));
    return `hace ${mins} min`;
  }
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export default function DiscoveryAgentHeartbeat({
  stats,
  lastRun,
}: {
  stats: PreAnalysisStats;
  lastRun: CronRun | null;
}) {
  const totalAttempted =
    stats.covered + stats.not_covered + stats.pending + stats.errored;
  const coveragePct =
    stats.candidate_pool > 0
      ? Math.round((stats.covered / stats.candidate_pool) * 100)
      : 0;

  return (
    <section className="rounded-2xl border border-navy-100 bg-white px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-navy-600">
            Pre-tiering del agente
          </h2>
          <p className="mt-0.5 text-xs text-navy-500">
            Calidad + moat + red flags pre-computados sobre el universo
            elegible para que veas tier antes de invertir tiempo de análisis.
          </p>
        </div>
        <Link
          href="/dashboard/agents"
          className="text-xs font-medium text-navy-700 underline-offset-2 hover:underline"
        >
          Ver agentes →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Cobertura"
          value={`${stats.covered}/${stats.candidate_pool}`}
          suffix={`${coveragePct}%`}
          tone="primary"
        />
        <Stat
          label="No soportadas"
          value={stats.not_covered.toString()}
          hint="SEC <5y · <2 fondos · <5 dimensiones"
        />
        <Stat
          label="Pendientes"
          value={(stats.pending + (stats.candidate_pool - totalAttempted)).toString()}
          hint="Próximo cron las procesará"
        />
        <Stat
          label="Errores"
          value={stats.errored.toString()}
          tone={stats.errored > 0 ? "warning" : "neutral"}
          hint={stats.errored > 0 ? "Reintento al próximo cron" : undefined}
        />
      </div>

      {stats.covered > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-navy-100 pt-3 text-xs text-navy-600">
          <span className="font-semibold uppercase tracking-wider text-navy-500">
            Tier distribution
          </span>
          <TierBar
            label="Exceptional"
            n={stats.by_tier.exceptional}
            chip="bg-emerald-500/10 text-emerald-700"
          />
          <TierBar
            label="Good"
            n={stats.by_tier.good}
            chip="bg-teal-500/10 text-teal-700"
          />
          <TierBar
            label="Mediocre"
            n={stats.by_tier.mediocre}
            chip="bg-amber-500/10 text-amber-700"
          />
          <TierBar
            label="Poor"
            n={stats.by_tier.poor}
            chip="bg-red-500/10 text-red-700"
          />
        </div>
      )}

      <div className="mt-3 text-[11px] uppercase tracking-wider text-navy-400">
        {lastRun
          ? `Última verificación ${formatRelative(lastRun.started_at)}${lastRun.processed_tickers ? ` · ${lastRun.processed_tickers} procesados` : ""}${lastRun.error_count ? ` · ${lastRun.error_count} errores` : ""}`
          : "Aún no se ha ejecutado el cron"}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  suffix,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  tone?: "primary" | "neutral" | "warning";
}) {
  const valueClass =
    tone === "primary"
      ? "text-navy-950"
      : tone === "warning"
        ? "text-amber-700"
        : "text-navy-700";
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-navy-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
        {suffix && (
          <span className="ml-1.5 text-xs font-normal text-navy-400">
            {suffix}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-navy-400">{hint}</div>}
    </div>
  );
}

function TierBar({
  label,
  n,
  chip,
}: {
  label: string;
  n: number;
  chip: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}
    >
      {label}
      <span className="font-mono tabular-nums">{n}</span>
    </span>
  );
}
