// Normalize share-class separators in stored tickers from "/" to "-".
//
// OpenFIGI returns share-class tickers with a slash (BRK/A, BRK/B), but
// Yahoo Finance — the rest of the pipeline — uses hyphens (BRK-A, BRK-B).
// The resolver has been updated to normalize at ingest; this script cleans
// up rows ingested before the fix. Affects two tables:
//   - discovery_cusip_ticker (cache, shared across users)
//   - discovery_holdings      (one row per fund position)
//
// Dry-run by default. Pass --apply to commit.
//
// Run:
//   node scripts/normalize-ticker-slashes.mjs           # dry-run
//   node scripts/normalize-ticker-slashes.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const cacheRows = await sql`
  SELECT cusip, ticker
  FROM discovery_cusip_ticker
  WHERE ticker LIKE '%/%'
  ORDER BY ticker
`;

const holdingRows = await sql`
  SELECT id, ticker
  FROM discovery_holdings
  WHERE ticker LIKE '%/%'
  ORDER BY ticker, id
`;

if (cacheRows.length === 0 && holdingRows.length === 0) {
  console.log("Nothing to normalize — no rows with a slash.");
  process.exit(0);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"}\n` +
    `  discovery_cusip_ticker : ${cacheRows.length} row(s)\n` +
    `  discovery_holdings     : ${holdingRows.length} row(s)\n`,
);

const cacheSample = cacheRows.slice(0, 6);
for (const r of cacheSample) {
  console.log(`  cache ${r.cusip}: ${r.ticker} → ${r.ticker.replace(/\//g, "-")}`);
}
if (cacheRows.length > cacheSample.length) {
  console.log(`  … and ${cacheRows.length - cacheSample.length} more in cache.`);
}
console.log("");

if (!apply) {
  console.log("Dry-run only — nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

const updatedCache = await sql`
  UPDATE discovery_cusip_ticker
  SET ticker = REPLACE(ticker, '/', '-')
  WHERE ticker LIKE '%/%'
`;

const updatedHoldings = await sql`
  UPDATE discovery_holdings
  SET ticker = REPLACE(ticker, '/', '-')
  WHERE ticker LIKE '%/%'
`;

console.log(
  `Done. Updated ${cacheRows.length} cache row(s) and ${holdingRows.length} holding row(s).`,
);
void updatedCache;
void updatedHoldings;
