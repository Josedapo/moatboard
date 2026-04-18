// Populate sec_fundamentals_cache with raw companyfacts for every ticker in
// the positions table. First step of the SEC EDGAR integration (Session 1 —
// raw cache only, no parsing yet).
//
// Re-implements the fetch + cache logic from src/lib/sec.ts inline because
// scripts run as plain Node ESM (no Next.js path aliases or TS compilation).
// Keep the two in sync when making fundamental changes to the SEC layer.
//
// Usage:
//   node scripts/populate-sec-raw.mjs
//   node scripts/populate-sec-raw.mjs --force   # ignore TTL, refetch everything

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

for (const key of ["DATABASE_URL", "SEC_USER_AGENT"]) {
  if (!process.env[key]) {
    console.error(`${key} is not set`);
    process.exit(1);
  }
}

const sql = neon(process.env.DATABASE_URL);
const UA = process.env.SEC_USER_AGENT;
const FORCE = process.argv.includes("--force");

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const CIK_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 150; // ~6 req/s, well under SEC's 10 req/s cap

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refreshTickerMap() {
  console.log("  Refreshing ticker → CIK map from sec.gov…");
  const res = await fetch(TICKER_MAP_URL, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Ticker map fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const rows = Object.values(data);
  const tickers = rows.map((r) => r.ticker.toUpperCase());
  const ciks = rows.map((r) => String(r.cik_str).padStart(10, "0"));
  const titles = rows.map((r) => r.title ?? "");

  await sql.query("TRUNCATE TABLE sec_ticker_cik");
  await sql.query(
    `INSERT INTO sec_ticker_cik (ticker, cik, title, last_refreshed)
     SELECT t, c, ti, NOW()
     FROM UNNEST($1::text[], $2::text[], $3::text[]) AS u(t, c, ti)`,
    [tickers, ciks, titles],
  );
  console.log(`  Inserted ${rows.length} ticker → CIK mappings.`);
}

async function ensureTickerMapFresh() {
  const rows = await sql`SELECT MAX(last_refreshed) AS last FROM sec_ticker_cik`;
  const last = rows[0]?.last;
  const fresh =
    last && Date.now() - new Date(last).getTime() < CIK_MAP_TTL_MS;
  if (!fresh) {
    await refreshTickerMap();
  } else {
    console.log(`  Ticker map is fresh (last refresh ${last}).`);
  }
}

async function getCikForTicker(ticker) {
  const key = ticker.toUpperCase();
  const rows = await sql`
    SELECT cik FROM sec_ticker_cik WHERE ticker = ${key} LIMIT 1
  `;
  return rows[0]?.cik ?? null;
}

async function fetchCompanyFacts(cik10) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      if (body.includes("Request Rate Threshold") && attempt === 0) {
        console.log("    Rate-limit hit — backing off 60s…");
        await sleep(60_000);
        continue;
      }
      throw new Error(`SEC 403 for CIK${cik10}: ${body.slice(0, 200)}`);
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(2_000);
      continue;
    }
    throw new Error(`SEC fetch failed for CIK${cik10}: ${res.status} ${res.statusText}`);
  }
  return null;
}

async function writeMiss(ticker, cik, status) {
  await sql`
    INSERT INTO sec_fundamentals_cache (ticker, cik, status, raw_facts, last_fetched)
    VALUES (${ticker}, ${cik}, ${status}, NULL, NOW())
    ON CONFLICT (ticker) DO UPDATE
      SET status = EXCLUDED.status,
          cik = EXCLUDED.cik,
          raw_facts = NULL,
          parsed_annual = NULL,
          years_available = NULL,
          earliest_year = NULL,
          latest_year = NULL,
          parse_notes = NULL,
          last_fetched = NOW()
  `;
}

async function writeOk(ticker, cik, facts) {
  await sql`
    INSERT INTO sec_fundamentals_cache (ticker, cik, entity_name, status, raw_facts, last_fetched)
    VALUES (${ticker}, ${cik}, ${facts.entityName ?? null}, 'ok', ${JSON.stringify(facts)}, NOW())
    ON CONFLICT (ticker) DO UPDATE
      SET cik = EXCLUDED.cik,
          entity_name = EXCLUDED.entity_name,
          status = 'ok',
          raw_facts = EXCLUDED.raw_facts,
          last_fetched = NOW()
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

await ensureTickerMapFresh();

const positions = await sql`
  SELECT DISTINCT ticker FROM positions ORDER BY ticker
`;
if (positions.length === 0) {
  console.log("\nNo positions found. Nothing to populate.");
  process.exit(0);
}
console.log(
  `\nPopulating SEC raw cache for ${positions.length} tickers: ${positions.map((p) => p.ticker).join(", ")}\n`,
);

const counts = { ok: 0, no_cik: 0, fetch_error: 0, skipped_fresh: 0 };
let totalBytes = 0;

for (const { ticker } of positions) {
  const key = ticker.toUpperCase();
  const label = key.padEnd(6);

  if (!FORCE) {
    const existing = await sql`
      SELECT status, last_fetched, octet_length(raw_facts::text) AS bytes
      FROM sec_fundamentals_cache WHERE ticker = ${key} LIMIT 1
    `;
    const row = existing[0];
    const fresh =
      row &&
      row.status === "ok" &&
      Date.now() - new Date(row.last_fetched).getTime() < FUNDAMENTALS_TTL_MS;
    if (fresh) {
      counts.skipped_fresh++;
      totalBytes += row.bytes ?? 0;
      console.log(`  ${label} skip (fresh cache)`);
      continue;
    }
  }

  const cik = await getCikForTicker(key);
  if (!cik) {
    await writeMiss(key, "", "no_cik");
    counts.no_cik++;
    console.log(`  ${label} no_cik (ticker not in SEC ticker map)`);
    continue;
  }

  try {
    const facts = await fetchCompanyFacts(cik);
    if (!facts) {
      await writeMiss(key, cik, "fetch_error");
      counts.fetch_error++;
      console.log(`  ${label} fetch_error (CIK${cik} returned no data)`);
    } else {
      await writeOk(key, cik, facts);
      const bytes = Buffer.byteLength(JSON.stringify(facts));
      totalBytes += bytes;
      counts.ok++;
      const entity = facts.entityName ?? "(unknown)";
      console.log(
        `  ${label} ok (CIK${cik}, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${entity})`,
      );
    }
  } catch (err) {
    await writeMiss(key, cik, "fetch_error");
    counts.fetch_error++;
    console.log(`  ${label} fetch_error (${err.message})`);
  }

  await sleep(RATE_LIMIT_DELAY_MS);
}

console.log(
  `\nDone. ok=${counts.ok}, no_cik=${counts.no_cik}, fetch_error=${counts.fetch_error}, skipped_fresh=${counts.skipped_fresh}`,
);
console.log(`Total raw_facts size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
