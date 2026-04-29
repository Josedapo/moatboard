// Drops the legacy 'completed' value from the CHECK constraints on
// `analysis_sessions.current_step` and `analysis_sessions.furthest_step`.
// Aligned with the eternal-resumable session model: there is no terminal
// "completed" state anymore, so the constraint should not permit writing
// it.
//
// Pre-flight check: any row still carrying 'completed' will fail the
// new constraint. Earlier in the same dev cycle (2026-04-29) we
// remapped 18 such rows to 'valuation'; this script bails loudly if it
// sees any survivors instead of silently dropping them.
//
// Idempotent: re-running after a successful migration is a no-op (the
// new constraint already excludes 'completed').

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function findConstraint(column) {
  const rows = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'analysis_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE ${`%${column}%`}
      AND pg_get_constraintdef(oid) ILIKE '%completed%'
  `;
  return rows[0]?.conname ?? null;
}

async function main() {
  console.log("[migrate] Checking for any 'completed' rows…");
  const stuck = await sql`
    SELECT id, user_id, ticker, current_step, furthest_step
    FROM analysis_sessions
    WHERE current_step = 'completed' OR furthest_step = 'completed'
  `;
  if (stuck.length > 0) {
    console.error(
      `[migrate] ABORT — ${stuck.length} row(s) still carry 'completed'. Remap them first.`,
    );
    console.error(stuck);
    process.exit(1);
  }

  console.log("[migrate] Locating existing CHECK constraints…");
  const currentName = await findConstraint("current_step");
  const furthestName = await findConstraint("furthest_step");

  if (!currentName && !furthestName) {
    console.log("[migrate] Constraints already exclude 'completed'. No-op.");
    return;
  }

  if (currentName) {
    console.log(`[migrate] Dropping ${currentName}…`);
    await sql.query(
      `ALTER TABLE analysis_sessions DROP CONSTRAINT ${currentName}`,
    );
    console.log("[migrate] Recreating current_step CHECK without 'completed'…");
    await sql`
      ALTER TABLE analysis_sessions
        ADD CONSTRAINT analysis_sessions_current_step_check
        CHECK (current_step IN ('understanding', 'red_flags', 'quality', 'valuation'))
    `;
  }

  if (furthestName) {
    console.log(`[migrate] Dropping ${furthestName}…`);
    await sql.query(
      `ALTER TABLE analysis_sessions DROP CONSTRAINT ${furthestName}`,
    );
    console.log("[migrate] Recreating furthest_step CHECK without 'completed'…");
    await sql`
      ALTER TABLE analysis_sessions
        ADD CONSTRAINT analysis_sessions_furthest_step_check
        CHECK (furthest_step IN ('understanding', 'red_flags', 'quality', 'valuation'))
    `;
  }

  console.log("[migrate] Done.");
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
