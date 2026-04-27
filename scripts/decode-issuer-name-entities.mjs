// Decode XML predefined entities in discovery_holdings.issuer_name.
//
// Some 13F filers use entity-escaped text inside <nameOfIssuer> (e.g.
// "SS&amp;C", "Accenture &apos;A&apos;"). The original parser captured
// them verbatim. The parser now decodes `&amp;`, `&apos;`, `&quot;`,
// `&lt;`, `&gt;`, and numeric refs. This script cleans up rows ingested
// before the fix.
//
// Dry-run by default. Pass --apply to commit.
//
// Run:
//   node scripts/decode-issuer-name-entities.mjs           # dry-run
//   node scripts/decode-issuer-name-entities.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

function decodeXmlText(raw) {
  return raw
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const candidates = await sql`
  SELECT id, issuer_name
  FROM discovery_holdings
  WHERE issuer_name ~ '&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);'
  ORDER BY id
`;

if (candidates.length === 0) {
  console.log("Nothing to decode — no rows contain entities.");
  process.exit(0);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} — ${candidates.length} holding row(s) to decode:\n`,
);

const sampleSize = Math.min(8, candidates.length);
for (let i = 0; i < sampleSize; i++) {
  const row = candidates[i];
  const cleaned = decodeXmlText(row.issuer_name).trim();
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

// Row-by-row update so the JS decoder (identical to the parser) runs on
// every value. Keeps parity guaranteed; 203 rows is fine.
let updated = 0;
for (const row of candidates) {
  const cleaned = decodeXmlText(row.issuer_name).trim();
  if (cleaned === row.issuer_name) continue;
  await sql`
    UPDATE discovery_holdings
    SET issuer_name = ${cleaned}
    WHERE id = ${row.id}
  `;
  updated++;
}

console.log(`Done. Updated ${updated} row(s).`);
