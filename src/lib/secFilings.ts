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
  // Form 4: insider transactions (Section 16 filings). One filing per
  // insider per day-of-transaction. High volume for mega-caps but small
  // payloads per filing. Parsed via form4Parser; filtered to open-market
  // purchases (code P) before emitting a signal.
  "4",
]);

export type RawFiling = {
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD — when the filing hit EDGAR
  reportDate: string | null; // YYYY-MM-DD — fiscal period end (null when SEC omits)
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

  const data = await fetchSubmissions(cik, ticker);
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

// Latest annual filing descriptor. Shared across AI features that
// want to ground their prompts in the real 10-K (business
// understanding, red flags, future DEF 14A consumers).
export type LatestAnnualFiling = {
  ticker: string;
  accession: string;
  form: "10-K" | "10-K/A" | "20-F" | "20-F/A";
  filingDate: string; // YYYY-MM-DD, when it hit EDGAR
  reportDate: string | null; // YYYY-MM-DD, fiscal period end
  primaryDocument: string;
  url: string;
};

const ANNUAL_FORMS_PRIMARY = new Set(["10-K", "10-K/A"]);
const ANNUAL_FORMS_FALLBACK = new Set(["20-F", "20-F/A"]);

// Tiny in-memory TTL cache. A 10-K is filed annually so refetching
// every 24h is overkill but costs almost nothing. The cache is per
// server instance; Vercel serverless cold starts will re-fetch on
// first call, which is fine.
const ANNUAL_FILING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const annualFilingCache = new Map<
  string,
  { filing: LatestAnnualFiling | null; ts: number }
>();

// Returns the most recent 10-K (or 10-K/A). For ADRs that file 20-F
// only, falls back to 20-F. Returns null when no annual filing exists
// (very new filer, no CIK match, etc.) — callers must tolerate.
export async function fetchLatestAnnualFiling(
  ticker: string,
): Promise<LatestAnnualFiling | null> {
  const key = ticker.toUpperCase();

  const cached = annualFilingCache.get(key);
  if (cached && Date.now() - cached.ts < ANNUAL_FILING_CACHE_TTL_MS) {
    return cached.filing;
  }

  const cik = await getCikForTicker(key);
  if (!cik) {
    annualFilingCache.set(key, { filing: null, ts: Date.now() });
    return null;
  }

  const data = await fetchSubmissions(cik, key);
  const recent = data.filings?.recent;
  if (!recent) {
    annualFilingCache.set(key, { filing: null, ts: Date.now() });
    return null;
  }

  const all = zipFilings(recent, cik);

  const pickLatest = (formSet: Set<string>): RawFiling | null => {
    const candidates = all
      .filter((f) => formSet.has(f.form))
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    return candidates[0] ?? null;
  };

  const picked =
    pickLatest(ANNUAL_FORMS_PRIMARY) ?? pickLatest(ANNUAL_FORMS_FALLBACK);

  if (!picked) {
    annualFilingCache.set(key, { filing: null, ts: Date.now() });
    return null;
  }

  const filing: LatestAnnualFiling = {
    ticker: key,
    accession: picked.accession,
    form: picked.form as LatestAnnualFiling["form"],
    filingDate: picked.filingDate,
    reportDate: picked.reportDate,
    primaryDocument: picked.primaryDocument,
    url: buildFilingUrl(picked),
  };

  annualFilingCache.set(key, { filing, ts: Date.now() });
  return filing;
}

// Shared raw fetch of the /submissions endpoint. Used by both
// fetchRecentFilings and fetchLatestAnnualFiling so there's only one
// place where the HTTP contract lives.
async function fetchSubmissions(
  cik: string,
  tickerForError: string,
): Promise<RawSubmissionsResponse> {
  const res = await fetch(SUBMISSIONS_URL(cik), {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `SEC submissions fetch failed for ${tickerForError}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as RawSubmissionsResponse;
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

// Build the raw-XML URL for a Form 4. SEC's submissions feed exposes
// `primaryDocument` with an `xslF345X05/` (or similar) prefix that
// resolves to the XSLT-transformed HTML. The raw XML lives at the same
// path without that prefix folder. Callers that need to parse the XML
// (form4Flow, Phase 2 DEF 14A if XBRL) go through here.
export function buildForm4RawXmlUrl(filing: RawFiling): string {
  const accNoDashes = filing.accession.replace(/-/g, "");
  const cikTrimmed = filing.cik.replace(/^0+/, "") || "0";
  // Strip any leading "xslF*/" segment from primaryDocument.
  const rawDoc = filing.primaryDocument.replace(/^xslF[^/]+\//, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikTrimmed}/${accNoDashes}/${rawDoc}`;
}

// Build a filing-index URL from just the accession number. Returns
// the EDGAR directory listing for that filing — user can click into
// the 10-K document from there. Useful when only the accession has
// been persisted (e.g. qualitative_red_flags.last_10k_accession).
// The first segment of an SEC accession is always the filer's CIK.
export function buildFilingIndexUrlFromAccession(accession: string): string {
  const parts = accession.split("-");
  const cik = parts[0] ? parts[0].replace(/^0+/, "") || "0" : "0";
  const accNoDashes = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/`;
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
      reportDate?: string[];
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
  const reportDates = recent.reportDate ?? [];
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
      reportDate: reportDates[i] || null,
      primaryDocument: docs[i] ?? "",
      items: items[i] || null,
      cik,
    });
  }
  return out;
}
