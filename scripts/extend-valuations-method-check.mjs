// Extends the CHECK constraint on valuations.method to include the new
// 'implied_return' method (2026-04-25 redesign — implied-return is now
// the primary verdict; DCF / AFFO / Excess Returns / AI multiples
// continue to be valid for legacy rows and the cross-check inside
// implied-return assumptions JSONB).
//
// Idempotent: drops the old constraint by name first, then adds the new
// one. Works whether or not the constraint exists.
//
// Run: node scripts/extend-valuations-method-check.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("Extending valuations.method CHECK constraint…");

  // Drop the named constraint first (idempotent — succeeds whether or not
  // it exists). Catches the case where the script ran before and added it.
  console.log("  · Dropping valuations_method_check if exists…");
  await sql`ALTER TABLE valuations DROP CONSTRAINT IF EXISTS valuations_method_check`;

  // Also drop any auto-named CHECK referencing `method` IN (...) — handles
  // the original constraint that Postgres auto-named when the table was
  // first created.
  const constraints = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'valuations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%method%IN%'
  `;
  for (const row of constraints) {
    console.log(`  · Dropping auto-named constraint ${row.conname}…`);
    await sql.query(
      `ALTER TABLE valuations DROP CONSTRAINT IF EXISTS "${row.conname}"`,
    );
  }

  console.log("  · Adding new constraint with 'implied_return'…");
  await sql`
    ALTER TABLE valuations
    ADD CONSTRAINT valuations_method_check
    CHECK (method IN ('implied_return', 'dcf', 'affo_dcf', 'excess_returns', 'ai_multiples'))
  `;

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
