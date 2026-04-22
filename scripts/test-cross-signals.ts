// One-shot dogfood script: invokes generateCrossSignalsForFiling
// against the latest Fundsmith filing to verify the plumbing without
// deleting any prod rows. Idempotent — re-running is a no-op once the
// signals exist.
//
// Run: npx tsx scripts/test-cross-signals.ts

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../src/lib/db");
  const { generateCrossSignalsForFiling } = await import(
    "../src/lib/discoveryCrossSignals"
  );

  const f = (await sql`
    SELECT f.id AS fund_id, df.id AS filing_id, df.accession,
           TO_CHAR(df.period_of_report, 'YYYY-MM-DD') AS period_of_report,
           TO_CHAR(df.filing_date, 'YYYY-MM-DD') AS filing_date
    FROM discovery_funds f
    JOIN discovery_filings df ON df.fund_id = f.id
    WHERE f.display_name = 'Fundsmith'
    ORDER BY df.period_of_report DESC LIMIT 1
  `) as unknown as Array<{
    fund_id: number;
    filing_id: number;
    accession: string;
    period_of_report: string;
    filing_date: string;
  }>;

  console.log("Latest Fundsmith filing:", f[0]);

  const created = await generateCrossSignalsForFiling({
    fundId: f[0].fund_id,
    filingId: f[0].filing_id,
    accession: f[0].accession,
    periodOfReport: f[0].period_of_report,
    filingDate: f[0].filing_date,
  });

  console.log("Cross-signals created this run:", created);

  const signals = (await sql`
    SELECT ticker, event_type, severity,
           raw_payload->>'fund_display_name' AS fund,
           raw_payload->>'movement' AS movement,
           raw_payload->>'shares_pct_change' AS pct,
           status
    FROM review_signals
    WHERE source = 'discovery_13f'
    ORDER BY id DESC
    LIMIT 20
  `) as unknown as Array<{
    ticker: string;
    event_type: string;
    severity: string;
    fund: string;
    movement: string;
    pct: string | null;
    status: string;
  }>;

  console.log(`\nAll discovery_13f signals in DB (${signals.length}):`);
  for (const s of signals) {
    console.log(
      `  ${s.ticker.padEnd(6)} ${s.movement.padEnd(6)} ` +
        `pct=${s.pct ?? "—"} fund=${s.fund} status=${s.status}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
