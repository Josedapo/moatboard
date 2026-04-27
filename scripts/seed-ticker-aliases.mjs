// Seed the ticker_aliases table with the dual-class pairs Joseda has
// detected in his universe. Idempotent — re-runs are no-ops thanks to
// ON CONFLICT (ticker) DO NOTHING.
//
// Convention for the canonical pick:
//   - The share class that the broader 13F coverage anchors on (most-
//     tracked funds report under it).
//   - When the two classes are roughly equivalent in 13F coverage, prefer
//     voting (investor signal) over non-voting.
//
// Add new rows as new dual-class businesses surface in Discovery.
//
// Run: node scripts/seed-ticker-aliases.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// [alias_ticker, canonical_ticker, rationale_for_canonical_choice]
const SEED = [
  [
    "GOOG",
    "GOOGL",
    "Alphabet — GOOGL (Class A, voting) is the share class 13F filers anchor on; GOOG (Class C, non-voting) is the alias.",
  ],
  [
    "BRK-B",
    "BRK-A",
    "Berkshire Hathaway — BRK-A is where all 13F coverage is anchored (Berkshire's own filings, Greenlight, Markel, etc. report it as the primary holding).",
  ],
];

console.log(`Seeding ${SEED.length} ticker alias pair(s)…`);

for (const [alias, canonical, notes] of SEED) {
  const result = await sql`
    INSERT INTO ticker_aliases (ticker, canonical_ticker, notes)
    VALUES (${alias}, ${canonical}, ${notes})
    ON CONFLICT (ticker) DO NOTHING
    RETURNING ticker
  `;
  if (result.length > 0) {
    console.log(`  inserted: ${alias} → ${canonical}`);
  } else {
    console.log(`  already present: ${alias} → ${canonical}`);
  }
}

console.log("Done.");
