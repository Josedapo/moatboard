// One-off: add ASTS (AST SpaceMobile) to validate the "Moatboard can't
// analyze this business" block. ASTS is a pre-revenue satellite company
// with structurally limited fundamentals — the quality framework
// shouldn't be able to score enough dimensions to assign a tier.

import { neon } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const USER_EMAIL = "jodapogo@gmail.com";
const TICKER = "ASTS";

const sql = neon(process.env.DATABASE_URL);
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const users =
  await sql`SELECT id FROM users WHERE email = ${USER_EMAIL} LIMIT 1`;
if (users.length === 0) {
  console.error(`User with email ${USER_EMAIL} not found.`);
  process.exit(1);
}
const userId = users[0].id;

const quote = await yf.quote(TICKER);
const price = quote?.regularMarketPrice;
if (!price) {
  console.error(`Could not fetch current price for ${TICKER}.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

const rows = await sql`
  INSERT INTO positions (user_id, ticker, purchase_price, purchase_date)
  VALUES (${userId}, ${TICKER}, ${price}, ${today})
  RETURNING id, ticker, purchase_price
`;

console.log(
  `${TICKER}: inserted position #${rows[0].id} at $${Number(rows[0].purchase_price).toFixed(2)}`,
);
