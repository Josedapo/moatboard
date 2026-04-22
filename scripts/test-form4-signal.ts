// Dogfood: exercise ensureInsiderSignalsForTicker against tickers likely
// to have recent open-market purchases (code=P). Doesn't mutate the
// user's portfolio/watchlist. Uses Joseda's user_id so signals land in
// his inbox if they qualify — cleaned up after the test by the caller
// if needed.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../src/lib/db");
  const { ensureInsiderSignalsForTicker } = await import(
    "../src/lib/form4Flow"
  );

  const users = (await sql`SELECT id FROM users ORDER BY id LIMIT 1`) as Array<{
    id: number;
  }>;
  if (users.length === 0) {
    console.error("No users in DB");
    process.exit(1);
  }
  const userId = users[0].id;
  console.log(`Using user_id=${userId}`);

  // Candidates with historically active open-market buys:
  // DIS: Disney, Bob Iger often on the news, insider buys reported
  // LYFT: mid-cap, execs have bought
  // DAL: Delta, management occasionally buys
  // TSLA: Elon's 10% owner buys
  // SIRI: media SiriusXM — various insiders
  const TICKERS = ["TSLA", "DIS", "SIRI", "DAL", "LYFT"];

  for (const ticker of TICKERS) {
    console.log(`\n=== ${ticker} ===`);
    const result = await ensureInsiderSignalsForTicker({
      userId,
      ticker,
      sinceDays: 365,
    });
    console.log(result);

    const purchases = await sql`
      SELECT transaction_date, reporting_owner_name, reporting_owner_title,
             shares::float AS s, price_per_share::float AS p,
             transaction_value_usd::float AS v, rule10b5_1_flag
      FROM insider_transactions
      WHERE ticker = ${ticker} AND transaction_code = 'P' AND acquired_disposed = 'A'
      ORDER BY transaction_date DESC LIMIT 5
    `;
    if (purchases.length > 0) {
      console.log(`  code=P purchases found: ${purchases.length}`);
      for (const p of purchases) console.log("   ", p);
    }
  }

  const signals = await sql`
    SELECT ticker, raw_payload->>'reporting_owner_name' AS owner,
           raw_payload->>'total_value_usd' AS total, event_date, status
    FROM review_signals
    WHERE source = 'sec_form4'
    ORDER BY id DESC LIMIT 10
  `;
  console.log(`\nReview signals emitted (sec_form4): ${signals.length}`);
  for (const s of signals) console.log(" ", s);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
