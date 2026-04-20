import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT ticker, source, event_type, severity, event_date, source_ref, raw_payload
  FROM review_signals
  ORDER BY event_date DESC, id DESC
  LIMIT 20
`;

for (const r of rows) {
  const items = r.raw_payload?.items ?? "";
  console.log(
    `${r.event_date.toISOString().slice(0, 10)}  ${r.ticker.padEnd(5)}  ${r.source.padEnd(8)}  ${r.severity.padEnd(13)}  ${r.event_type.padEnd(22)}  ${r.source_ref.padEnd(22)}  items="${items}"`,
  );
}

console.log(`\n${rows.length} rows`);

const counts = await sql`
  SELECT status, COUNT(*)::INTEGER AS count
  FROM review_signals
  GROUP BY status
`;
console.log(
  "\nStatus:",
  counts.map((r) => `${r.status}=${r.count}`).join(", "),
);

const runs = await sql`
  SELECT id, job, started_at, finished_at, ok, processed_tickers, inserted_signals, error_count
  FROM cron_runs ORDER BY id DESC LIMIT 3
`;
console.log("\nCron runs:");
for (const r of runs) {
  console.log(
    `  #${r.id} ${r.job} ok=${r.ok} processed=${r.processed_tickers} inserted=${r.inserted_signals} errors=${r.error_count}`,
  );
}
