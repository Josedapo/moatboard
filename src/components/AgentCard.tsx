"use client";

import { useState, useTransition } from "react";
import type { AgentRunResult } from "@/app/dashboard/agents/actions";

// Visual treatment of a Moatboard agent (the user-facing framing of
// the underlying cron job). The card reads like an employee profile
// card — avatar with initial, name, role, frequency badge prominent,
// timing strip below, manual-invoke button at the foot. Anti-trading
// philosophy still applies: the button exists for legitimate "refresh
// now" needs (after a known earnings release, after seeing a cron
// failure on Vercel) — not to encourage compulsive re-checking.
export type AgentCardData = {
  id: string; // stable key, used for nothing else
  name: string;
  role: string;
  description: string;
  // Human-readable frequency (e.g. "Cada día · 07:00 UTC").
  frequencyLabel: string;
  // ISO strings or null when no run on record.
  lastRunIso: string | null;
  lastRunOk: boolean;
  // Compact stats summary from the last run (e.g. "5 nuevas señales · 12 tickers").
  lastRunSummary: string | null;
  // ISO of the next scheduled execution.
  nextRunIso: string;
  // Server action that triggers a manual run. Returns ok + summary or error.
  invoke: () => Promise<AgentRunResult>;
};

export default function AgentCard({ agent }: { agent: AgentCardData }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<AgentRunResult | null>(null);

  const onInvoke = () => {
    setResult(null);
    startTransition(async () => {
      const r = await agent.invoke();
      setResult(r);
    });
  };

  const initial = agent.name.slice(0, 1).toUpperCase();
  const lastRel = agent.lastRunIso
    ? humaniseRelative(agent.lastRunIso, "past")
    : "Sin ejecuciones previas";
  const lastAbs = agent.lastRunIso ? formatAbsolute(agent.lastRunIso) : null;
  const nextRel = humaniseRelative(agent.nextRunIso, "future");
  const nextAbs = formatAbsolute(agent.nextRunIso);

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      {/* Identity strip */}
      <header className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy-900 font-serif text-2xl font-semibold text-white">
          {initial}
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-navy-950">{agent.name}</h3>
          <p className="mt-0.5 text-sm italic text-navy-600">{agent.role}</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
          {agent.frequencyLabel}
        </span>
      </header>

      {/* Plain-language description */}
      <p className="text-sm leading-relaxed text-navy-700">
        {agent.description}
      </p>

      {/* Timing strip — last + next run */}
      <div className="grid gap-4 rounded-xl border border-navy-100 bg-navy-50/40 p-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Última ejecución
          </p>
          <p
            className={`mt-1 text-sm font-medium ${agent.lastRunOk ? "text-navy-900" : "text-red-700"}`}
          >
            {lastRel}
          </p>
          {lastAbs && (
            <p className="mt-0.5 text-[11px] text-navy-500">{lastAbs}</p>
          )}
          {agent.lastRunSummary && (
            <p className="mt-1 text-[12px] text-navy-600">
              {agent.lastRunSummary}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Próxima ejecución
          </p>
          <p className="mt-1 text-sm font-medium text-navy-900">{nextRel}</p>
          <p className="mt-0.5 text-[11px] text-navy-500">{nextAbs}</p>
        </div>
      </div>

      {/* Manual invoke action */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onInvoke}
          disabled={isPending}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-wait disabled:opacity-50"
        >
          {isPending ? "Ejecutando…" : "Ejecutar ahora"}
        </button>
        {result?.ok && (
          <span className="text-xs text-emerald-700">
            <span aria-hidden className="mr-1">
              ✓
            </span>
            {result.summary}
          </span>
        )}
        {result && !result.ok && (
          <span className="text-xs text-red-700">
            <span aria-hidden className="mr-1">
              ✗
            </span>
            {result.error}
          </span>
        )}
      </div>
    </article>
  );
}

// "Hace 6 horas" / "En 18 horas". Coarse enough that the card doesn't
// constantly re-render to refresh the seconds. Caller is server-side,
// so the rendered string is fixed at request time — fine, since the
// cron cadence is daily/weekly anyway.
function humaniseRelative(iso: string, direction: "past" | "future"): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = direction === "past" ? now - target : target - now;
  const minutes = Math.round(diffMs / (60 * 1000));
  const prefix = direction === "past" ? "Hace" : "En";

  if (minutes < 1) return direction === "past" ? "Justo ahora" : "Inminente";
  if (minutes < 60) return `${prefix} ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${prefix} ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${prefix} ${days} ${days === 1 ? "día" : "días"}`;
  const weeks = Math.round(days / 7);
  return `${prefix} ${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  // Compact label in Spanish: "25 abr 07:00 UTC". Forces UTC so the
  // string reads identically server-side and client-side and matches
  // the cron schedule's frame of reference.
  const date = d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date} · ${time} UTC`;
}
