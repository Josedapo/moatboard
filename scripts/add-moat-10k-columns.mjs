// Additive migration: ground the moat assessment in a real 10-K.
// Mirrors the columns already added to business_understanding so the
// staleness check + source-excerpt rendering use the same pattern.
//
// Safe to re-run — every ALTER uses IF NOT EXISTS.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

console.log("Adding 10-K columns to moat_assessments...");

await sql`ALTER TABLE moat_assessments ADD COLUMN IF NOT EXISTS source_excerpt TEXT`;
await sql`ALTER TABLE moat_assessments ADD COLUMN IF NOT EXISTS last_10k_accession VARCHAR(30)`;
await sql`ALTER TABLE moat_assessments ADD COLUMN IF NOT EXISTS last_10k_period_end DATE`;

const rows = await sql`
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE last_10k_accession IS NULL) AS without_filing
  FROM moat_assessments
`;

console.log(
  `moat_assessments rows: ${rows[0].total} total, ${rows[0].without_filing} without 10-K accession (will regenerate on next access via staleness check).`,
);
console.log("Done.");
