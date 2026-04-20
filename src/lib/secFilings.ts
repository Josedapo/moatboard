// SEC EDGAR recent-filings feed. Lighter than companyfacts (~50 KB/ticker)
// and the canonical source for event-driven review signals: every 8-K and
// every periodic report goes through the /submissions endpoint. This is
// where the review_signals cron starts its work.
//
// Scope of this file:
//   - Fetch `/submissions/CIK{cik}.json`
//   - Zip the parallel arrays into per-filing objects
//   - Filter to forms we care about + a recency window
//   - No DB, no classification — hand the candidates to signalClassifier
//
// Kept separate from `sec.ts` (companyfacts pipeline) so touching one
// doesn't regress the other.

import { getCikForTicker } from "@/lib/sec";

const SEC_USER_AGENT = process.env.SEC_USER_AGENT;
if (!SEC_USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is not set. SEC EDGAR requires 'Name Email' format.",
  );
}

const SUBMISSIONS_URL = (cik10: string) =>
  `https://data.sec.gov/submissions/CIK${cik10}.json`;

// The forms we ever care about at the classifier layer. Anything else
// (SC 13G, 13F, 3/4/5, DEF 14A, S-1...) is dropped at fetch time so we
// don't waste rows walking them. DEF 14A is flagged for Phase 2; today
// it's out of scope.
const RELEVANT_FORMS = new Set([
  "8-K",
  "8-K/A",
  "10-Q",
  "10-Q/A",
  "10-K",
  "10-K/A",
]);

export type RawFiling = {
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  primaryDocument: string; // filename used to build the URL
  items: string | null; // comma-separated, only populated on 8-K
  cik: string;
};

// Fetch recent filings for a ticker. `sinceDays` filters to a trailing
// window (default 180d) so back-history doesn't flood the classifier on
// first run; the cron runs daily so after the first pass the effective
// window is ~1d anyway.
//
// Returns null when the ticker has no CIK (foreign listing, recently
// renamed, or SEC map out of sync). Throws on network / parse error so
// the caller can record it in the cron_runs error_summary.
export async function fetchRecentFilings(
  ticker: string,
  opts: { sinceDays?: number } = {},
): Promise<RawFiling[] | null> {
  const sinceDays = opts.sinceDays ?? 180;

  const cik = await getCikForTicker(ticker);
  if (!cik) return null;

  const res = await fetch(SUBMISSIONS_URL(cik), {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `SEC submissions fetch failed for ${ticker}: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as RawSubmissionsResponse;
  const recent = data.filings?.recent;
  if (!recent) return [];

  const all = zipFilings(recent, cik);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDays);

  return all.filter((f) => {
    if (!RELEVANT_FORMS.has(f.form)) return false;
    const d = new Date(f.filingDate);
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  });
}

// Build a canonical SEC-filing URL from accession + primary document.
// Used as the `source_url` on the signal row so a click takes Joseda
// straight to EDGAR.
export function buildFilingUrl(filing: RawFiling): string {
  // Accession format: 0000320193-25-000108 → strip dashes for path
  const accNoDashes = filing.accession.replace(/-/g, "");
  // CIK in path is without leading zeros
  const cikTrimmed = filing.cik.replace(/^0+/, "") || "0";
  return `https://www.sec.gov/Archives/edgar/data/${cikTrimmed}/${accNoDashes}/${filing.primaryDocument}`;
}

// -----------------------------------------------------------------------
// Internal: SEC returns parallel arrays; zip into proper objects.
// -----------------------------------------------------------------------

type RawSubmissionsResponse = {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
};

function zipFilings(
  recent: NonNullable<NonNullable<RawSubmissionsResponse["filings"]>["recent"]>,
  cik: string,
): RawFiling[] {
  const accessions = recent.accessionNumber ?? [];
  const dates = recent.filingDate ?? [];
  const forms = recent.form ?? [];
  const docs = recent.primaryDocument ?? [];
  const items = recent.items ?? [];
  const n = Math.min(accessions.length, dates.length, forms.length);

  const out: RawFiling[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      accession: accessions[i],
      form: forms[i],
      filingDate: dates[i],
      primaryDocument: docs[i] ?? "",
      items: items[i] || null,
      cik,
    });
  }
  return out;
}
