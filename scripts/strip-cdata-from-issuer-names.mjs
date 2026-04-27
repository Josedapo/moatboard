// Strip <![CDATA[...]]> wrappers from discovery_holdings.issuer_name.
//
// Some 13F filers wrap text nodes in CDATA. The original parser in thirteenF.ts
// captured the raw block between tags verbatim, persisting the wrapper as part
// of the issuer name. The parser has been fixed; this script cleans up rows
// ingested before the fix.
//
// Dry-run by default. Pass --apply to commit.
//
// Run:
//   node scripts/strip-cdata-from-issuer-names.mjs           # dry-run
//   node scripts/strip-cdata-from-issuer-names.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const candidates = await sql`
  SELECT id, issuer_name
  FROM discovery_holdings
  WHERE issuer_name LIKE '%CDATA%'
  ORDER BY id
`;

if (candidates.length === 0) {
  console.log("Nothing to strip — no rows contain CDATA.");
  process.exit(0);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} — ${candidates.length} holding row(s) to clean:\n`,
);

const sampleSize = Math.min(5, candidates.length);
for (let i = 0; i < sampleSize; i++) {
  const row = candidates[i];
  const cleaned = row.issuer_name
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
  console.log(`  id=${row.id}`);
  console.log(`    BEFORE: ${JSON.stringify(row.issuer_name)}`);
  console.log(`    AFTER:  ${JSON.stringify(cleaned)}`);
}
if (candidates.length > sampleSize) {
  console.log(`  … and ${candidates.length - sampleSize} more.`);
}
console.log("");

if (!apply) {
  console.log("Dry-run only — nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

// Batch update in SQL — regex replace, server-side.
const result = await sql`
  UPDATE discovery_holdings
  SET issuer_name = TRIM(
    REGEXP_REPLACE(issuer_name, '<!\\[CDATA\\[(.*?)\\]\\]>', '\\1', 'g')
  )
  WHERE issuer_name LIKE '%CDATA%'
`;

console.log(`Done. Updated ${candidates.length} row(s).`);
