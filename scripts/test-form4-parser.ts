// One-shot dogfood: fetch a real Form 4 from SEC EDGAR, parse it,
// print the result. Validates the regex-based parser on an authentic
// filing before the cron hits it at scale.
//
// Run: npx tsx scripts/test-form4-parser.ts

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { fetchRecentFilings, buildForm4RawXmlUrl } = await import(
    "../src/lib/secFilings"
  );
  const { fetchFilingRawXml } = await import("../src/lib/secDocument");
  const { parseForm4Xml, isCeoOrCfo } = await import("../src/lib/form4Parser");

  // Try a ticker from the Fundsmith dogfood portfolio. Visa has enough
  // insider activity that at least one Form 4 will show up in a 180-day
  // window. If not, rotate to another.
  const TICKERS = ["V", "MAR", "META", "GOOGL"];

  for (const ticker of TICKERS) {
    console.log(`\n=== ${ticker} ===`);
    const filings = await fetchRecentFilings(ticker, { sinceDays: 180 });
    if (!filings) {
      console.log("  no CIK");
      continue;
    }
    const form4s = filings.filter((f) => f.form === "4");
    console.log(`  ${form4s.length} Form 4s in 180d`);
    if (form4s.length === 0) continue;

    const first = form4s[0];
    const url = buildForm4RawXmlUrl(first);
    console.log(`  Fetching ${url}`);
    const xml = await fetchFilingRawXml(url);
    console.log(`  XML length: ${xml.length} bytes`);

    const parsed = parseForm4Xml(xml);
    console.log(
      `  Issuer: ${parsed.issuerName} (CIK ${parsed.issuerCik}, symbol ${parsed.issuerTradingSymbol})`,
    );
    console.log(
      `  Owner:  ${parsed.reportingOwnerName} [${parsed.reportingOwnerTitle ?? "—"}] officer=${parsed.isOfficer} director=${parsed.isDirector} 10%=${parsed.isTenPercentOwner}`,
    );
    console.log(
      `  isCeoOrCfo(title): ${isCeoOrCfo(parsed.reportingOwnerTitle)}`,
    );
    console.log(
      `  Non-derivative transactions: ${parsed.nonDerivativeTransactions.length}`,
    );
    for (const t of parsed.nonDerivativeTransactions) {
      const valueUsd = t.shares * t.pricePerShare;
      console.log(
        `    ${t.transactionDate} code=${t.transactionCode} ${t.acquiredDisposed} shares=${t.shares} price=$${t.pricePerShare} value=$${valueUsd.toFixed(0)} 10b5-1=${t.rule10b5_1Flag} ${t.directOrIndirect}`,
      );
    }
    break; // only first ticker with Form 4s
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
