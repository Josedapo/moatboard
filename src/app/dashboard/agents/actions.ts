"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { runDailySignalsJob } from "@/lib/signalFlow";
import { runWeeklyDiscoveryJob } from "@/lib/discoveryFlow";
import { expireOldSignals } from "@/lib/reviewSignals";

// Manual invocations of the same jobs that Vercel Cron schedules.
// Both bypass the HTTP route — they call the lib helpers directly so
// there's no auth-header dance, no HTTP overhead, and the heartbeat
// row in `cron_runs` is identical to the scheduled run. Useful when
// Joseda wants to refresh the inbox right now (after a known earnings
// release, after a discovery cron failure, after adding a new ticker
// to watchlist).
//
// The auth gate is the user being signed in — these are personal-tool
// operations, no rate limiting beyond Joseda's own restraint.

export type AgentRunResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

export async function invokeSignalsAgentAction(): Promise<AgentRunResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "No autenticado" };

  try {
    const { summary, insiderSummary } = await runDailySignalsJob();
    const expired = await expireOldSignals(90);

    const newSignals = summary.reduce((acc, s) => acc + s.inserted, 0);
    const tickersScanned = summary.length;
    const errors = summary.filter((s) => s.errored).length;
    const insiderSignals = insiderSummary.reduce(
      (acc, s) => acc + s.signalsInserted,
      0,
    );

    const parts: string[] = [];
    parts.push(`${newSignals} ${newSignals === 1 ? "señal" : "señales"} SEC`);
    if (insiderSignals > 0) {
      parts.push(
        `${insiderSignals} ${insiderSignals === 1 ? "compra de insider" : "compras de insiders"}`,
      );
    }
    parts.push(`${tickersScanned} tickers escaneados`);
    if (expired > 0) parts.push(`${expired} expiradas (>90d)`);
    if (errors > 0) parts.push(`${errors} errores`);

    revalidatePath("/dashboard/agents");
    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard");
    return { ok: true, summary: parts.join(" · ") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("invokeSignalsAgentAction failed:", msg);
    return { ok: false, error: msg };
  }
}

export async function invokeDiscoveryAgentAction(): Promise<AgentRunResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "No autenticado" };

  try {
    const { summary, crossSignalsCreated } = await runWeeklyDiscoveryJob();
    const newFilings = summary.filter((s) => s.status === "ok_new").length;
    const cachedFilings = summary.filter(
      (s) => s.status === "ok_cached",
    ).length;
    const errors = summary.filter((s) => s.status === "error").length;

    const parts: string[] = [];
    parts.push(
      `${newFilings} ${newFilings === 1 ? "nuevo 13F" : "nuevos 13F"}`,
    );
    if (cachedFilings > 0) parts.push(`${cachedFilings} ya cacheados`);
    if (crossSignalsCreated > 0) {
      parts.push(
        `${crossSignalsCreated} ${crossSignalsCreated === 1 ? "movimiento detectado" : "movimientos detectados"}`,
      );
    }
    if (errors > 0) parts.push(`${errors} errores`);

    revalidatePath("/dashboard/agents");
    revalidatePath("/dashboard/discovery");
    revalidatePath("/dashboard/inbox");
    return { ok: true, summary: parts.join(" · ") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("invokeDiscoveryAgentAction failed:", msg);
    return { ok: false, error: msg };
  }
}
