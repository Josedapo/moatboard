import { auth } from "@/auth";
import { getLatestCronRun } from "@/lib/cronRuns";
import DashboardNav from "@/components/DashboardNav";
import AgentCard, { type AgentCardData } from "@/components/AgentCard";
import {
  invokeSignalsAgentAction,
  invokeDiscoveryAgentAction,
} from "./actions";

export const metadata = {
  title: "Agentes · Moatboard",
};

// Agents = the user-facing framing of the cron jobs that quietly run
// the data layer. Presenting them as named employees is editorial
// (matches the "Observatorio Personal de Inversión" tagline) and
// honest — these are background workers with discrete jobs, schedules,
// and outputs the user can audit and trigger on demand.
export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [signalsRun, discoveryRun] = await Promise.all([
    getLatestCronRun("signals_daily"),
    getLatestCronRun("discovery_weekly"),
  ]);

  const now = new Date();
  const signalsAgent: AgentCardData = {
    id: "iris",
    name: "Iris",
    role: "Vigilante de SEC EDGAR",
    description:
      "Cada mañana revisa todos los tickers que tienes en cartera o watchlist y se asoma a SEC EDGAR para buscar presentaciones nuevas. Cuando aparece un 10-Q, 10-K o un 8-K con un Item relevante (cambios de directivos, restatements, fusiones, eventos materiales), te lo deja en el Inbox. También rastrea las compras de insiders (Form 4) en esas mismas empresas.",
    frequencyLabel: "Cada día · 07:00 UTC",
    lastRunIso: signalsRun?.started_at ?? null,
    lastRunOk: signalsRun?.ok ?? false,
    lastRunSummary: summariseSignalsRun(signalsRun),
    nextRunIso: nextDailyAt(now, 7).toISOString(),
    invoke: invokeSignalsAgentAction,
  };

  const discoveryAgent: AgentCardData = {
    id: "hugo",
    name: "Hugo",
    role: "Rastreador de fondos curados",
    description:
      "Cada lunes recorre los 31 fondos de inversión seleccionados (los Quality Compounders, Value, Growth y Concentrados que sigue Moatboard) y comprueba si han presentado un 13F nuevo. Cuando aparece, lo parsea, actualiza el leaderboard de Discovery, y te avisa en el Inbox si alguno de tus tickers ha entrado, salido o cambiado de peso significativo en la cartera de un fondo.",
    frequencyLabel: "Cada lunes · 07:00 UTC",
    lastRunIso: discoveryRun?.started_at ?? null,
    lastRunOk: discoveryRun?.ok ?? false,
    lastRunSummary: summariseDiscoveryRun(discoveryRun),
    nextRunIso: nextWeeklyAt(now, 1, 7).toISOString(),
    invoke: invokeDiscoveryAgentAction,
  };

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-navy-950">Agentes</h1>
          <p className="mt-2 max-w-3xl text-navy-600">
            Empleados autónomos de Moatboard. Cada uno tiene una función
            concreta, una frecuencia de trabajo y deja un rastro auditable
            de lo que ha hecho. Puedes invocarlos a mano cuando lo necesites
            (por ejemplo, después de unos resultados que esperabas o si la
            ejecución programada falló).
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <AgentCard agent={signalsAgent} />
          <AgentCard agent={discoveryAgent} />
        </div>
      </main>
    </div>
  );
}

// Build a compact one-line summary of the previous run from the
// cron_runs row. Different agents emit different counters; the row
// already carries `processed_tickers`, `inserted_signals`, `error_count`,
// and an optional `error_summary` for the failure path.
function summariseSignalsRun(
  run: { ok: boolean; processed_tickers: number | null; inserted_signals: number | null; error_count: number | null; error_summary: string | null } | null,
): string | null {
  if (!run) return null;
  if (!run.ok) {
    return run.error_summary
      ? `Falló: ${run.error_summary.slice(0, 120)}`
      : "Falló (sin resumen de error)";
  }
  const parts: string[] = [];
  parts.push(
    `${run.inserted_signals ?? 0} ${run.inserted_signals === 1 ? "señal nueva" : "señales nuevas"}`,
  );
  parts.push(`${run.processed_tickers ?? 0} tickers escaneados`);
  if ((run.error_count ?? 0) > 0) parts.push(`${run.error_count} errores`);
  return parts.join(" · ");
}

function summariseDiscoveryRun(
  run: { ok: boolean; processed_tickers: number | null; inserted_signals: number | null; error_count: number | null; error_summary: string | null } | null,
): string | null {
  if (!run) return null;
  if (!run.ok) {
    return run.error_summary
      ? `Falló: ${run.error_summary.slice(0, 120)}`
      : "Falló (sin resumen de error)";
  }
  // Discovery's cron writes `processed_tickers` = funds processed and
  // `inserted_signals` = cross-signals created (movements that affected
  // the user's tickers). The numbers carry different meanings here than
  // in signals_daily, which is why each agent has its own summariser.
  const parts: string[] = [];
  parts.push(`${run.processed_tickers ?? 0} fondos revisados`);
  parts.push(
    `${run.inserted_signals ?? 0} ${run.inserted_signals === 1 ? "movimiento detectado" : "movimientos detectados"}`,
  );
  if ((run.error_count ?? 0) > 0) parts.push(`${run.error_count} errores`);
  return parts.join(" · ");
}

// Next occurrence of the daily 07:00 UTC tick (the signals cron).
// Today if we haven't passed 07:00 UTC yet, tomorrow otherwise.
function nextDailyAt(now: Date, hourUtc: number): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

// Next occurrence of a weekly cron (Discovery: Mondays 07:00 UTC).
// `dayOfWeekUtc` follows the JS convention (0 = Sunday, 1 = Monday).
function nextWeeklyAt(now: Date, dayOfWeekUtc: number, hourUtc: number): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  const currentDow = next.getUTCDay();
  let delta = (dayOfWeekUtc - currentDow + 7) % 7;
  // If today is the target day but we've already passed the hour, push to next week.
  if (delta === 0 && next.getTime() <= now.getTime()) delta = 7;
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}
