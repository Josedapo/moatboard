// Rewrite alias-keyed ticker_states rows to their canonical ticker.
// Run after seed-ticker-aliases.mjs has populated ticker_aliases.
//
// Logic:
//   For each ticker_states row whose ticker matches an alias entry:
//     - If a (user_id, canonical) row already exists: keep the most recent
//       (last_touched_at) and DELETE the other.
//     - Else: UPDATE ticker = canonical.
//
// Preserves the user's intent. Example: if a user added GOOG to watchlist
// then later analyzed GOOGL and discarded it, the GOOGL discard wins
// because last_touched_at is more recent.
//
// Dry-run by default. Pass --apply to commit.
//
//   node scripts/canonicalize-ticker-states.mjs           # dry-run
//   node scripts/canonicalize-ticker-states.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const aliasRows = await sql`SELECT ticker, canonical_ticker FROM ticker_aliases`;
if (aliasRows.length === 0) {
  console.log("No aliases configured. Nothing to migrate.");
  process.exit(0);
}

const aliasMap = new Map();
for (const r of aliasRows) {
  aliasMap.set(r.ticker, r.canonical_ticker);
}

// Pull every ticker_states row whose ticker is an alias.
const aliasTickers = [...aliasMap.keys()];
const rows = await sql`
  SELECT id, user_id, ticker, status, last_touched_at
  FROM ticker_states
  WHERE ticker = ANY(${aliasTickers})
  ORDER BY user_id, ticker
`;

if (rows.length === 0) {
  console.log("No alias-keyed ticker_states rows found. Nothing to migrate.");
  process.exit(0);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} — ${rows.length} alias-keyed row(s) to canonicalize.\n`,
);

const updates = [];
const deletes = [];

for (const row of rows) {
  const canonical = aliasMap.get(row.ticker);
  // Look for an existing canonical row for the same user.
  const existing = await sql`
    SELECT id, status, last_touched_at
    FROM ticker_states
    WHERE user_id = ${row.user_id} AND ticker = ${canonical}
    LIMIT 1
  `;
  if (existing.length === 0) {
    updates.push({ id: row.id, from: row.ticker, to: canonical, user: row.user_id });
    console.log(
      `  user=${row.user_id}: UPDATE ticker_states.id=${row.id} ${row.ticker} → ${canonical} (status=${row.status})`,
    );
  } else {
    const ex = existing[0];
    const aliasMs = new Date(row.last_touched_at).getTime();
    const canonMs = new Date(ex.last_touched_at).getTime();
    if (aliasMs > canonMs) {
      // Alias row is newer: drop canonical, then update alias to canonical.
      deletes.push({ id: ex.id, ticker: canonical, user: row.user_id });
      updates.push({ id: row.id, from: row.ticker, to: canonical, user: row.user_id });
      console.log(
        `  user=${row.user_id}: DELETE older canonical id=${ex.id} (${canonical}, status=${ex.status}); UPDATE alias id=${row.id} ${row.ticker} → ${canonical} (status=${row.status})`,
      );
    } else {
      // Canonical row is newer or equal: drop the alias.
      deletes.push({ id: row.id, ticker: row.ticker, user: row.user_id });
      console.log(
        `  user=${row.user_id}: DELETE alias id=${row.id} (${row.ticker}, status=${row.status}) — keeping canonical id=${ex.id} (status=${ex.status})`,
      );
    }
  }
}

console.log(
  `\nSummary: ${updates.length} UPDATE, ${deletes.length} DELETE.`,
);

if (!apply) {
  console.log("Dry-run only — nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

for (const d of deletes) {
  await sql`DELETE FROM ticker_states WHERE id = ${d.id}`;
}
for (const u of updates) {
  await sql`UPDATE ticker_states SET ticker = ${u.to} WHERE id = ${u.id}`;
}
console.log("Done.");
