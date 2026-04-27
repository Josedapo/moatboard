// CUSIP → ticker resolver for Discovery's 13F holdings.
//
// Strategy: check the discovery_cusip_ticker cache first, batch
// remaining CUSIPs through OpenFIGI's free /v3/mapping endpoint (25k
// req/month, no auth, 10 ids per request), persist every resolution
// (including unresolvables as ticker=null so we don't re-query).
//
// Heuristic for picking among OpenFIGI's multiple matches per CUSIP:
// prefer the US composite listing (exchCode === "US") for an Equity
// marketSector. That collapses e.g. AAPL/UN, AAPL/UQ, AAPL/UW into
// the canonical "AAPL" on exchange "US".

import { sql } from "@/lib/db";

const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";
const BATCH_SIZE = 10; // OpenFIGI hard limit per request on the free tier
// Free tier without API key: 25 req/min (= 60s/25 = 2.4s between
// requests). Use 2.6s to give a safety margin. With an API key we
// could push to 60 req/min, but this is a one-time backfill and the
// CUSIPs get cached, so the throttle only matters on first run.
const THROTTLE_MS = 2600;

export type CusipResolution = {
  cusip: string;
  ticker: string | null;
  issuer_name: string | null;
  exchange_code: string | null;
};

// Public entrypoint. Returns a Map keyed by CUSIP with the best
// resolution for each. Missing CUSIPs (unresolvable) get ticker=null.
export async function resolveCusips(
  cusips: string[],
): Promise<Map<string, CusipResolution>> {
  const uniq = Array.from(new Set(cusips.map((c) => c.trim().toUpperCase())));
  const out = new Map<string, CusipResolution>();
  if (uniq.length === 0) return out;

  // 1. Read cache
  const cached = (await sql`
    SELECT cusip, ticker, issuer_name, exchange_code
    FROM discovery_cusip_ticker
    WHERE cusip = ANY(${uniq}::text[])
  `) as unknown as CusipResolution[];
  for (const row of cached) {
    out.set(row.cusip, row);
  }

  const missing = uniq.filter((c) => !out.has(c));
  if (missing.length === 0) return out;

  // 2. Batch-resolve via OpenFIGI. Transport / HTTP failures propagate
  // as a BatchFailure so the caller can surface them without polluting
  // the cache with spurious "unresolvable" rows.
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    let resolutions: CusipResolution[];
    try {
      resolutions = await resolveBatch(batch);
    } catch (err) {
      console.error(
        `OpenFIGI batch failed (will retry next run): ${(err as Error).message}`,
      );
      // Mark in-memory as unresolved but DO NOT persist — next run
      // will re-query these CUSIPs.
      for (const cusip of batch) {
        out.set(cusip, {
          cusip,
          ticker: null,
          issuer_name: null,
          exchange_code: null,
        });
      }
      if (i + BATCH_SIZE < missing.length) {
        await sleep(THROTTLE_MS);
      }
      continue;
    }
    for (const r of resolutions) {
      out.set(r.cusip, r);
      await persistResolution(r);
    }
    if (i + BATCH_SIZE < missing.length) {
      await sleep(THROTTLE_MS);
    }
  }

  return out;
}

async function resolveBatch(cusips: string[]): Promise<CusipResolution[]> {
  const body = cusips.map((c) => ({ idType: "ID_CUSIP", idValue: c }));

  const res = await fetch(OPENFIGI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // 429 rate limit or 5xx — surface as error so caller doesn't
    // cache a spurious "unresolvable" result. A legitimate "no match"
    // still comes through as an empty data[] in a 200 response and
    // IS cached (useful to avoid repeat lookups on truly missing
    // securities).
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenFIGI ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }

  const payload = (await res.json()) as Array<
    | { data?: OpenFigiMatch[] }
    | { warning?: string }
    | { error?: string }
  >;

  const results: CusipResolution[] = [];
  for (let i = 0; i < cusips.length; i++) {
    const cusip = cusips[i];
    const entry = payload[i];
    const matches = (entry as { data?: OpenFigiMatch[] }).data ?? [];
    const best = pickBestMatch(matches);
    // Schema caps ticker at 10 chars — OpenFIGI occasionally returns
    // extended ticker strings (multi-class shares, foreign issuers).
    // Null them rather than truncate: a truncated ticker looks valid
    // but would misroute the analyze wizard.
    //
    // OpenFIGI uses slash separators for share classes (BRK/A, BRK/B).
    // Yahoo Finance uses hyphens (BRK-A, BRK-B). Normalize at ingest so
    // Discovery displays and analyze-links use the same canonical form.
    const rawTicker = best?.ticker?.replace(/\//g, "-") ?? null;
    const ticker = rawTicker && rawTicker.length <= 10 ? rawTicker : null;
    results.push({
      cusip,
      ticker,
      issuer_name: best?.name ?? null,
      exchange_code: best?.exchCode ?? null,
    });
  }
  return results;
}

// Prefer US composite Equity listing. Falls back to first Equity match
// on any US exchange, then the absolute first match.
function pickBestMatch(matches: OpenFigiMatch[]): OpenFigiMatch | null {
  if (matches.length === 0) return null;

  const usComposite = matches.find(
    (m) => m.marketSector === "Equity" && m.exchCode === "US",
  );
  if (usComposite) return usComposite;

  const anyUsEquity = matches.find(
    (m) =>
      m.marketSector === "Equity" &&
      typeof m.exchCode === "string" &&
      m.exchCode.startsWith("U"),
  );
  if (anyUsEquity) return anyUsEquity;

  return matches[0];
}

async function persistResolution(r: CusipResolution): Promise<void> {
  await sql`
    INSERT INTO discovery_cusip_ticker
      (cusip, ticker, issuer_name, exchange_code, source)
    VALUES (${r.cusip}, ${r.ticker}, ${r.issuer_name}, ${r.exchange_code}, 'openfigi')
    ON CONFLICT (cusip) DO UPDATE
      SET ticker = EXCLUDED.ticker,
          issuer_name = EXCLUDED.issuer_name,
          exchange_code = EXCLUDED.exchange_code,
          resolved_at = NOW(),
          source = EXCLUDED.source
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type OpenFigiMatch = {
  figi?: string;
  name?: string;
  ticker?: string;
  exchCode?: string;
  compositeFIGI?: string;
  securityType?: string;
  marketSector?: string;
};
