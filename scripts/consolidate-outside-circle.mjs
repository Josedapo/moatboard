// Consolidate outside_circle → discarded.
//
// Joseda's mental model is 3 states (in_portfolio / watchlist /
// discarded), not 4. The wizard's "no entiendo el negocio" exit ramp
// keeps the same UX but routes to discarded with a pre-filled reason
// "Fuera del círculo de competencia" so the original signal is not
// lost.
//
// Two CHECK constraints to relax + (defensive) UPDATE for any future
// outside_circle rows that might exist when this script reruns.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

console.log("Step 1: convert any existing outside_circle rows to discarded...");

const tsUpdated = await sql`
  UPDATE ticker_states
  SET status = 'discarded',
      reason_md = CASE
        WHEN reason_md IS NULL OR reason_md = '' THEN 'Fuera del círculo de competencia'
        ELSE 'Fuera del círculo de competencia · ' || reason_md
      END,
      last_touched_at = NOW()
  WHERE status = 'outside_circle'
  RETURNING id
`;
console.log(`  ticker_states rows migrated: ${tsUpdated.length}`);

const asUpdated = await sql`
  UPDATE analysis_sessions
  SET outcome = 'discarded'
  WHERE outcome = 'outside_circle'
  RETURNING id
`;
console.log(`  analysis_sessions rows migrated: ${asUpdated.length}`);

console.log("\nStep 2: drop and recreate CHECK constraint on ticker_states.status...");

// Drop by definition match (constraint name is auto-generated).
const tsConstraint = await sql`
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'ticker_states'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%outside_circle%'
`;
for (const c of tsConstraint) {
  await sql.query(`ALTER TABLE ticker_states DROP CONSTRAINT ${c.conname}`);
  console.log(`  dropped ${c.conname}`);
}
await sql`
  ALTER TABLE ticker_states
  ADD CONSTRAINT ticker_states_status_check
  CHECK (status IN ('in_portfolio', 'watchlist', 'discarded'))
`;
console.log("  added new CHECK (3 states)");

console.log("\nStep 3: drop and recreate CHECK constraint on analysis_sessions.outcome...");

const asConstraint = await sql`
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'analysis_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%outside_circle%'
`;
for (const c of asConstraint) {
  await sql.query(`ALTER TABLE analysis_sessions DROP CONSTRAINT ${c.conname}`);
  console.log(`  dropped ${c.conname}`);
}
await sql`
  ALTER TABLE analysis_sessions
  ADD CONSTRAINT analysis_sessions_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('invested', 'watchlist', 'discarded', 'abandoned'))
`;
console.log("  added new CHECK (4 outcomes — no outside_circle)");

console.log("\nStep 4: verify final state...");
const ts = await sql`SELECT status, COUNT(*)::int AS n FROM ticker_states GROUP BY status ORDER BY status`;
console.log("ticker_states:");
for (const r of ts) console.log(`  ${r.status}: ${r.n}`);
const as = await sql`SELECT outcome, COUNT(*)::int AS n FROM analysis_sessions WHERE outcome IS NOT NULL GROUP BY outcome ORDER BY outcome`;
console.log("analysis_sessions outcomes:");
for (const r of as) console.log(`  ${r.outcome}: ${r.n}`);
console.log("\nDone.");
