// Phase 6 cleanup — analysis_sessions schema simplification.
//
// Post-2026-04-28 watchlist refactor: the wizard no longer has a
// terminal Decision step, so sessions never get `outcome` or
// `completed_at` populated. The columns survived Phase 1 for back-
// compat but are now pure dead weight. Same for the partial unique
// index (`WHERE completed_at IS NULL`) — without writes setting
// completed_at, every row qualifies, so a full unique index over
// `(user_id, ticker)` is the right shape.
//
// Operations:
//   1. Dedupe (user_id, ticker) — keep the row with the highest
//      last_active_at (tiebreak by id desc). Legacy rows where
//      multiple completed sessions coexisted for the same pair would
//      otherwise violate the new full unique index.
//   2. Drop columns `outcome` + `completed_at` + their CHECK constraints.
//   3. Drop partial index `uniq_active_analysis_session`.
//   4. Create full unique index `uniq_analysis_session_user_ticker`.
//
// Idempotent: detects whether `completed_at` still exists; exits early
// if not. Within a single run, every ALTER uses IF EXISTS where
// available.
//
// Dry-run by default. Pass --apply to commit.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const banner = apply ? "APPLY" : "DRY-RUN";
console.log(`${banner} — Phase 6 analysis_sessions cleanup\n`);

// 1. Idempotency check — bail if `completed_at` already gone.
const completedAtExists = await sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analysis_sessions'
      AND column_name = 'completed_at'
  ) AS exists
`;
if (!completedAtExists[0].exists) {
  console.log(
    "completed_at already gone — migration appears applied. Exiting.",
  );
  process.exit(0);
}

// 2. Pre-flight reporting.
const totalRows = await sql`SELECT COUNT(*)::int AS c FROM analysis_sessions`;
console.log(`  Total rows: ${totalRows[0].c}`);

const dupes = await sql`
  SELECT user_id, ticker, COUNT(*)::int AS n
    FROM analysis_sessions
   GROUP BY user_id, ticker
  HAVING COUNT(*) > 1
   ORDER BY n DESC, user_id, ticker
`;
console.log(`  (user_id, ticker) groups with >1 row: ${dupes.length}`);
if (dupes.length > 0) {
  console.log("  preview:");
  for (const row of dupes.slice(0, 10)) {
    console.log(`    user=${row.user_id} ticker=${row.ticker}: ${row.n} rows`);
  }
}

const completedRows = await sql`
  SELECT COUNT(*)::int AS c FROM analysis_sessions WHERE completed_at IS NOT NULL
`;
const outcomeRows = await sql`
  SELECT outcome, COUNT(*)::int AS c
    FROM analysis_sessions
   WHERE outcome IS NOT NULL
   GROUP BY outcome
   ORDER BY outcome
`;
console.log(`  Rows with completed_at set: ${completedRows[0].c}`);
console.log("  Rows by outcome (non-null):");
if (outcomeRows.length === 0) {
  console.log("    (none)");
} else {
  for (const row of outcomeRows) {
    console.log(`    ${row.outcome}: ${row.c}`);
  }
}

if (!apply) {
  console.log(
    "\nDry-run only — nothing written. Re-run with --apply to commit.",
  );
  process.exit(0);
}

// 3. Apply phase.
console.log("\nApplying changes…\n");

console.log(
  "  · Dedupe (user_id, ticker): keep highest last_active_at, tiebreak by id desc…",
);
const deleted = await sql`
  DELETE FROM analysis_sessions a
   USING analysis_sessions b
   WHERE a.user_id = b.user_id
     AND a.ticker = b.ticker
     AND (a.last_active_at < b.last_active_at
          OR (a.last_active_at = b.last_active_at AND a.id < b.id))
  RETURNING a.id
`;
console.log(`    · removed ${deleted.length} duplicate row(s)`);

console.log("  · Drop partial unique index uniq_active_analysis_session…");
await sql`DROP INDEX IF EXISTS uniq_active_analysis_session`;

// outcome CHECK constraint — drop both possible names.
console.log("  · Drop outcome CHECK constraint(s)…");
await sql`ALTER TABLE analysis_sessions DROP CONSTRAINT IF EXISTS analysis_sessions_outcome_check`;
const outcomeAuto = await sql`
  SELECT conname
    FROM pg_constraint
   WHERE conrelid = 'analysis_sessions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%outcome%IN%'
`;
for (const row of outcomeAuto) {
  console.log(`    · dropping auto-named ${row.conname}…`);
  await sql.query(
    `ALTER TABLE analysis_sessions DROP CONSTRAINT IF EXISTS "${row.conname}"`,
  );
}

console.log("  · Drop columns outcome + completed_at…");
await sql`ALTER TABLE analysis_sessions DROP COLUMN IF EXISTS outcome`;
await sql`ALTER TABLE analysis_sessions DROP COLUMN IF EXISTS completed_at`;

console.log("  · Create full unique index on (user_id, ticker)…");
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_analysis_session_user_ticker
    ON analysis_sessions(user_id, ticker)
`;

console.log("\nMigration applied successfully.");
console.log(
  "Next: deploy code that no longer queries outcome / completed_at on analysis_sessions.",
);
