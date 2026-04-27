// Migrate per-ticker IA cache rows from alias keys to canonical keys.
// Preserves AI work already paid for (Claude calls cost real money).
//
// Tables touched:
//   - business_understanding   (PK: ticker, version)
//   - qualitative_red_flags    (PK: ticker)
//   - moat_assessments         (PK: ticker)
//   - valuation_guides         (PK: ticker)
//   - sec_fundamentals_cache   (PK: ticker)
//   - sec_ticker_cik           (PK: ticker; harmless to leave both rows)
//
// Logic per table:
//   For each alias→canonical mapping:
//     If a canonical row exists: skip (canonical wins, alias row preserved
//       for back-compat — additive convention, no DROPs).
//     Else: copy the alias row INTO the canonical (INSERT) so the cached
//       analysis lives under the canonical key the new code reads from.
//
// Dry-run by default. Pass --apply to commit.
//
//   node scripts/canonicalize-cache-keys.mjs           # dry-run
//   node scripts/canonicalize-cache-keys.mjs --apply   # commit

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

console.log(`${apply ? "APPLY" : "DRY-RUN"} — copying alias-keyed cache rows to canonical when canonical absent.\n`);

let totalCopies = 0;
let totalSkips = 0;

for (const { ticker: alias, canonical_ticker: canonical } of aliasRows) {
  console.log(`\n[${alias} → ${canonical}]`);

  // ---------- moat_assessments ----------
  {
    const aliasRow = await sql`SELECT * FROM moat_assessments WHERE ticker = ${alias}`;
    if (aliasRow.length === 0) {
      console.log(`  moat_assessments: no alias row — skip.`);
    } else {
      const canonRow = await sql`SELECT 1 FROM moat_assessments WHERE ticker = ${canonical}`;
      if (canonRow.length > 0) {
        console.log(`  moat_assessments: canonical exists, skip.`);
        totalSkips += 1;
      } else {
        console.log(`  moat_assessments: COPY alias → canonical.`);
        if (apply) {
          const r = aliasRow[0];
          await sql`
            INSERT INTO moat_assessments
              (ticker, strength, archetype, reasoning, evaluated_at, evaluated_with_model)
            VALUES
              (${canonical}, ${r.strength}, ${r.archetype}, ${r.reasoning},
               ${r.evaluated_at}, ${r.evaluated_with_model})
          `;
        }
        totalCopies += 1;
      }
    }
  }

  // ---------- qualitative_red_flags ----------
  {
    const aliasRow = await sql`SELECT * FROM qualitative_red_flags WHERE ticker = ${alias}`;
    if (aliasRow.length === 0) {
      console.log(`  qualitative_red_flags: no alias row — skip.`);
    } else {
      const canonRow = await sql`SELECT 1 FROM qualitative_red_flags WHERE ticker = ${canonical}`;
      if (canonRow.length > 0) {
        console.log(`  qualitative_red_flags: canonical exists, skip.`);
        totalSkips += 1;
      } else {
        console.log(`  qualitative_red_flags: COPY alias → canonical.`);
        if (apply) {
          const r = aliasRow[0];
          await sql`
            INSERT INTO qualitative_red_flags
              (ticker, flags, last_10k_accession, last_10k_period_end,
               generated_at, generated_with_model)
            VALUES
              (${canonical}, ${JSON.stringify(r.flags)}::jsonb,
               ${r.last_10k_accession}, ${r.last_10k_period_end},
               ${r.generated_at}, ${r.generated_with_model})
          `;
        }
        totalCopies += 1;
      }
    }
  }

  // ---------- valuation_guides ----------
  {
    const aliasRow = await sql`SELECT * FROM valuation_guides WHERE ticker = ${alias}`;
    if (aliasRow.length === 0) {
      console.log(`  valuation_guides: no alias row — skip.`);
    } else {
      const canonRow = await sql`SELECT 1 FROM valuation_guides WHERE ticker = ${canonical}`;
      if (canonRow.length > 0) {
        console.log(`  valuation_guides: canonical exists, skip.`);
        totalSkips += 1;
      } else {
        console.log(`  valuation_guides: COPY alias → canonical.`);
        if (apply) {
          const r = aliasRow[0];
          await sql`
            INSERT INTO valuation_guides
              (ticker, primary_tool, secondary_tool, cautious_tool, reasoning,
               evaluated_at, evaluated_with_model)
            VALUES
              (${canonical}, ${r.primary_tool}, ${r.secondary_tool},
               ${r.cautious_tool}, ${r.reasoning},
               ${r.evaluated_at}, ${r.evaluated_with_model})
          `;
        }
        totalCopies += 1;
      }
    }
  }

  // ---------- business_understanding (versioned: copy ALL versions) ----------
  {
    const aliasVersions = await sql`
      SELECT * FROM business_understanding WHERE ticker = ${alias} ORDER BY version
    `;
    if (aliasVersions.length === 0) {
      console.log(`  business_understanding: no alias rows — skip.`);
    } else {
      const canonRow = await sql`SELECT 1 FROM business_understanding WHERE ticker = ${canonical} LIMIT 1`;
      if (canonRow.length > 0) {
        console.log(`  business_understanding: canonical exists (any version), skip.`);
        totalSkips += 1;
      } else {
        console.log(`  business_understanding: COPY ${aliasVersions.length} version(s) alias → canonical.`);
        if (apply) {
          for (const r of aliasVersions) {
            await sql`
              INSERT INTO business_understanding
                (ticker, version, summary_md, questions_and_answers, sources,
                 generated_at, generated_with_model, archived_at,
                 last_10k_accession, last_10k_period_end)
              VALUES
                (${canonical}, ${r.version}, ${r.summary_md},
                 ${JSON.stringify(r.questions_and_answers)}::jsonb,
                 ${JSON.stringify(r.sources)}::jsonb,
                 ${r.generated_at}, ${r.generated_with_model}, ${r.archived_at},
                 ${r.last_10k_accession}, ${r.last_10k_period_end})
            `;
          }
        }
        totalCopies += 1;
      }
    }
  }

  // ---------- sec_fundamentals_cache (rich payload — copy if canonical missing) ----------
  {
    const aliasRow = await sql`SELECT * FROM sec_fundamentals_cache WHERE ticker = ${alias}`;
    if (aliasRow.length === 0) {
      console.log(`  sec_fundamentals_cache: no alias row — skip.`);
    } else {
      const canonRow = await sql`SELECT 1 FROM sec_fundamentals_cache WHERE ticker = ${canonical}`;
      if (canonRow.length > 0) {
        console.log(`  sec_fundamentals_cache: canonical exists, skip.`);
        totalSkips += 1;
      } else {
        console.log(`  sec_fundamentals_cache: COPY alias → canonical.`);
        if (apply) {
          const r = aliasRow[0];
          await sql`
            INSERT INTO sec_fundamentals_cache
              (ticker, cik, entity_name, status, raw_facts, parsed_annual,
               parse_notes, years_available, earliest_year, latest_year,
               latest_quarter_accession, latest_quarter_period_end,
               latest_quarter_form, latest_quarter_filed, last_fetched)
            VALUES
              (${canonical}, ${r.cik}, ${r.entity_name}, ${r.status},
               ${r.raw_facts ? JSON.stringify(r.raw_facts) : null}::jsonb,
               ${r.parsed_annual ? JSON.stringify(r.parsed_annual) : null}::jsonb,
               ${r.parse_notes ? JSON.stringify(r.parse_notes) : null}::jsonb,
               ${r.years_available}, ${r.earliest_year}, ${r.latest_year},
               ${r.latest_quarter_accession}, ${r.latest_quarter_period_end},
               ${r.latest_quarter_form}, ${r.latest_quarter_filed},
               ${r.last_fetched})
          `;
        }
        totalCopies += 1;
      }
    }
  }
}

console.log(
  `\nSummary: ${totalCopies} table-row(s) copied, ${totalSkips} skipped (canonical already populated).`,
);
if (!apply) {
  console.log("Dry-run only — nothing written. Re-run with --apply to commit.");
}
