// Phase 1 migration — collapse ticker_states' state machine into a pure
// watchlist toggle.
//
// Conceptual change: cartera (positions con net>0) is the only "owned"
// state, watchlist becomes a tag with no fields. Discarded /
// outside_circle disappear as concepts.
//
// SQL operations:
//   1. DELETE FROM ticker_states WHERE status IN ('in_portfolio', 'discarded')
//      (in_portfolio is now derived; discarded is killed as a concept)
//   2. Drop status / reason_md / review_when / prior_reason_on_invest_md columns
//   3. Rename ticker_states → watchlist_entries; rename its index
//   4. Remap analysis_sessions current_step / furthest_step = 'decision' to 'valuation'
//   5. Drop + recreate the CHECK constraints on those two columns without 'decision'
//
// outcome / completed_at on analysis_sessions are NOT touched in this
// phase. Phase 6 cleanup may drop them entirely.
//
// Idempotent: detects whether `watchlist_entries` already exists and exits
// early. Within a single run, every ALTER uses IF EXISTS / IF NOT EXISTS
// where possible. Auto-named CHECK constraints are looked up via
// pg_constraint and dropped by name.
//
// Dry-run by default: prints counts and planned ops, writes nothing.
// Pass --apply to actually execute.
//
// Run:
//   node scripts/migrate-watchlist-tags.mjs           # dry-run
//   node scripts/migrate-watchlist-tags.mjs --apply   # commit

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
console.log(`${banner} — Phase 1 watchlist refactor migration\n`);

// 1. Idempotency check.
const watchlistExists = await sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'watchlist_entries'
  ) AS exists
`;
if (watchlistExists[0].exists) {
  console.log(
    "watchlist_entries already exists — migration appears to have been applied.\n" +
      "Exiting early to avoid double-apply.",
  );
  process.exit(0);
}

// 2. Pre-flight reporting.
console.log("Pre-flight counts:\n");

const tickerStateCounts = await sql`
  SELECT status, COUNT(*)::int AS count
  FROM ticker_states
  GROUP BY status
  ORDER BY status
`;
console.log("  ticker_states by status:");
if (tickerStateCounts.length === 0) {
  console.log("    (no rows)");
} else {
  for (const row of tickerStateCounts) {
    console.log(`    ${row.status}: ${row.count}`);
  }
}

const priorReasonRows = await sql`
  SELECT id, user_id, ticker, status, prior_reason_on_invest_md
  FROM ticker_states
  WHERE prior_reason_on_invest_md IS NOT NULL
`;
console.log(
  `\n  ticker_states with prior_reason_on_invest_md set: ${priorReasonRows.length}`,
);
if (priorReasonRows.length > 0) {
  console.log("    (these reasons will be lost — preview:)");
  for (const row of priorReasonRows.slice(0, 5)) {
    const preview = (row.prior_reason_on_invest_md ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    console.log(`    [${row.ticker}] (${row.status}) "${preview}…"`);
  }
}

const sessionStepCounts = await sql`
  SELECT current_step, furthest_step, COUNT(*)::int AS count
  FROM analysis_sessions
  GROUP BY current_step, furthest_step
  ORDER BY current_step, furthest_step
`;
console.log("\n  analysis_sessions by (current_step, furthest_step):");
if (sessionStepCounts.length === 0) {
  console.log("    (no rows)");
} else {
  for (const row of sessionStepCounts) {
    console.log(
      `    current=${row.current_step}, furthest=${row.furthest_step}: ${row.count}`,
    );
  }
}

const decisionStepRows = await sql`
  SELECT COUNT(*)::int AS count
  FROM analysis_sessions
  WHERE current_step = 'decision' OR furthest_step = 'decision'
`;
console.log(
  `\n  analysis_sessions with step='decision' to remap: ${decisionStepRows[0].count}`,
);

const toDelete = await sql`
  SELECT COUNT(*)::int AS count
  FROM ticker_states
  WHERE status IN ('in_portfolio', 'discarded')
`;
const toKeep = await sql`
  SELECT COUNT(*)::int AS count
  FROM ticker_states
  WHERE status = 'watchlist'
`;
console.log(`\n  ticker_states rows to DELETE: ${toDelete[0].count}`);
console.log(`  ticker_states rows to KEEP (watchlist): ${toKeep[0].count}`);

if (!apply) {
  console.log(
    "\nDry-run only — nothing written. Re-run with --apply to commit.",
  );
  process.exit(0);
}

// 3. Apply phase.
console.log("\nApplying changes…\n");

console.log("  · DELETE non-watchlist rows from ticker_states…");
await sql`
  DELETE FROM ticker_states
  WHERE status IN ('in_portfolio', 'discarded')
`;

console.log("  · Drop dependent index idx_ticker_states_user_status…");
await sql`DROP INDEX IF EXISTS idx_ticker_states_user_status`;

// CHECK constraint on status — drop both possible names.
console.log("  · Drop status CHECK constraint(s)…");
await sql`ALTER TABLE ticker_states DROP CONSTRAINT IF EXISTS ticker_states_status_check`;
const statusConstraints = await sql`
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'ticker_states'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%'
`;
for (const row of statusConstraints) {
  console.log(`    · dropping auto-named ${row.conname}…`);
  await sql.query(
    `ALTER TABLE ticker_states DROP CONSTRAINT IF EXISTS "${row.conname}"`,
  );
}

console.log("  · Drop columns status / reason_md / review_when / prior_reason_on_invest_md…");
await sql`ALTER TABLE ticker_states DROP COLUMN IF EXISTS status`;
await sql`ALTER TABLE ticker_states DROP COLUMN IF EXISTS reason_md`;
await sql`ALTER TABLE ticker_states DROP COLUMN IF EXISTS review_when`;
await sql`ALTER TABLE ticker_states DROP COLUMN IF EXISTS prior_reason_on_invest_md`;

console.log("  · Rename ticker_states → watchlist_entries…");
await sql`ALTER TABLE ticker_states RENAME TO watchlist_entries`;

console.log("  · Rename idx_ticker_states_user_id → idx_watchlist_entries_user_id…");
await sql`ALTER INDEX idx_ticker_states_user_id RENAME TO idx_watchlist_entries_user_id`;

console.log("  · Remap analysis_sessions step='decision' → 'valuation'…");
const remapCurrent = await sql`
  UPDATE analysis_sessions
  SET current_step = 'valuation'
  WHERE current_step = 'decision'
  RETURNING id
`;
console.log(`    · current_step remapped: ${remapCurrent.length} row(s)`);
const remapFurthest = await sql`
  UPDATE analysis_sessions
  SET furthest_step = 'valuation'
  WHERE furthest_step = 'decision'
  RETURNING id
`;
console.log(`    · furthest_step remapped: ${remapFurthest.length} row(s)`);

console.log("  · Drop + recreate CHECK on analysis_sessions.current_step (no 'decision')…");
await sql`
  ALTER TABLE analysis_sessions
  DROP CONSTRAINT IF EXISTS analysis_sessions_current_step_check
`;
const currentStepAuto = await sql`
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'analysis_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%current_step%IN%'
`;
for (const row of currentStepAuto) {
  console.log(`    · dropping auto-named ${row.conname}…`);
  await sql.query(
    `ALTER TABLE analysis_sessions DROP CONSTRAINT IF EXISTS "${row.conname}"`,
  );
}
await sql`
  ALTER TABLE analysis_sessions
  ADD CONSTRAINT analysis_sessions_current_step_check
  CHECK (current_step IN ('understanding', 'red_flags', 'quality', 'valuation', 'completed'))
`;

console.log("  · Drop + recreate CHECK on analysis_sessions.furthest_step (no 'decision')…");
await sql`
  ALTER TABLE analysis_sessions
  DROP CONSTRAINT IF EXISTS analysis_sessions_furthest_step_check
`;
const furthestStepAuto = await sql`
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'analysis_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%furthest_step%IN%'
`;
for (const row of furthestStepAuto) {
  console.log(`    · dropping auto-named ${row.conname}…`);
  await sql.query(
    `ALTER TABLE analysis_sessions DROP CONSTRAINT IF EXISTS "${row.conname}"`,
  );
}
await sql`
  ALTER TABLE analysis_sessions
  ADD CONSTRAINT analysis_sessions_furthest_step_check
  CHECK (furthest_step IN ('understanding', 'red_flags', 'quality', 'valuation', 'completed'))
`;

console.log("\nMigration applied successfully.");
console.log(
  "Next: deploy code that targets watchlist_entries (rename of lib/tickerStates.ts → lib/watchlistEntries.ts).",
);
