// Clean up spurious "unresolvable" cache entries caused by earlier
// OpenFIGI rate-limit failures that were incorrectly persisted as
// ticker=null. Deletes those rows, then walks every discovery_holdings
// row with ticker IS NULL, re-queries OpenFIGI with the corrected
// resolver (which now propagates HTTP errors instead of caching null),
// and updates the holdings table with newly-resolved tickers.
//
// Run: npx tsx scripts/reresolve-cusips.ts

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../src/lib/db");
  const { resolveCusips } = await import("../src/lib/cusip");

  // 1. Clean cache of null rows
  const deleted = (await sql`
    DELETE FROM discovery_cusip_ticker WHERE ticker IS NULL
    RETURNING cusip
  `) as unknown as { cusip: string }[];
  console.log(`Cleared ${deleted.length} null cache rows.`);

  // 2. Collect all CUSIPs with no resolution in holdings
  const rows = (await sql`
    SELECT DISTINCT cusip
    FROM discovery_holdings
    WHERE ticker IS NULL
    ORDER BY cusip
  `) as unknown as { cusip: string }[];
  const cusips = rows.map((r) => r.cusip);
  console.log(`Unresolved holdings distinct CUSIPs: ${cusips.length}`);

  if (cusips.length === 0) {
    console.log("Nothing to re-resolve.");
    return;
  }

  // 3. Batch-resolve (resolver handles throttle + retry semantics now)
  const resolved = await resolveCusips(cusips);

  // 4. Update holdings table for CUSIPs that got a ticker
  let updated = 0;
  let stillNull = 0;
  for (const cusip of cusips) {
    const r = resolved.get(cusip);
    if (r?.ticker) {
      const result = await sql`
        UPDATE discovery_holdings
        SET ticker = ${r.ticker}
        WHERE cusip = ${cusip} AND ticker IS NULL
        RETURNING id
      `;
      updated += (result as unknown as { id: number }[]).length;
    } else {
      stillNull += 1;
    }
  }

  console.log(`Updated ${updated} holdings with newly-resolved tickers.`);
  console.log(`Still null: ${stillNull} distinct CUSIPs (truly unresolvable).`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
