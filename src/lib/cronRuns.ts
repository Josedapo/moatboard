import { sql } from "@/lib/db";

export type CronRun = {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  processed_tickers: number | null;
  inserted_signals: number | null;
  error_count: number | null;
  error_summary: string | null;
};

// Latest successful cron run for a given job, used by the dashboard
// heartbeat banner. Falls back to the most recent row (even if failed)
// so the UI can surface "last attempt" separately from "last success"
// if needed.
export async function getLatestCronRun(
  job: string,
): Promise<CronRun | null> {
  const rows = (await sql`
    SELECT id, job, started_at, finished_at, ok,
           processed_tickers, inserted_signals, error_count, error_summary
    FROM cron_runs
    WHERE job = ${job}
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `) as unknown as CronRun[];
  return rows[0] ?? null;
}
