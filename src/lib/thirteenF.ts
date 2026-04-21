// 13F-HR fetcher + parser for Discovery.
//
// Two responsibilities:
//   1. Locate the latest 13F-HR filing for a fund (via /submissions
//      endpoint, filtered by form type).
//   2. Fetch its information table XML and parse it into a list of
//      holdings suitable for insertion into discovery_holdings.
//
// Pattern mirrors secFilings.ts: regex-based XML parsing (no DOM/xml2js
// dependency), explicit User-Agent, cache: "no-store". 13F info tables
// are well-structured XML so regex is sufficient and keeps the bundle
// small.
//
// Value semantics: SEC Form 13F reports "value" in thousands of USD.
// The parser returns `value_usd` as whole dollars (i.e. the raw XML
// value is multiplied by 1000). Downstream consumers work in dollars.

const SEC_USER_AGENT = process.env.SEC_USER_AGENT;
if (!SEC_USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is not set. SEC EDGAR requires 'Name Email' format.",
  );
}

const SUBMISSIONS_URL = (cik10: string) =>
  `https://data.sec.gov/submissions/CIK${cik10}.json`;

// Describes one position in a 13F information table. Value is returned
// in USD dollars (raw XML * 1000 since 13F reports in thousands).
export type ThirteenFHolding = {
  cusip: string;
  issuer_name: string;
  class_title: string | null;
  shares: bigint;
  value_usd: number;
  shares_type: "SH" | "PRN";
};

// Metadata of a 13F-HR filing. Does NOT include holdings — fetch those
// separately via parseInformationTable so the caller can decide whether
// to skip unchanged accessions before doing the XML work.
export type ThirteenFFilingRef = {
  accession: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string; // YYYY-MM-DD
  periodOfReport: string; // YYYY-MM-DD (quarter end)
  primaryDocument: string;
  infoTableUrl: string; // resolved after directory listing
};

// Find the most recent 13F-HR (or 13F-HR/A) filing for the given CIK.
// Thin wrapper around fetchRecentThirteenFFilings for callers that only
// care about the latest one.
export async function fetchLatestThirteenFFiling(
  cik: string,
): Promise<ThirteenFFilingRef | null> {
  const recent = await fetchRecentThirteenFFilings(cik, 1);
  return recent[0] ?? null;
}

// Find the N most recent 13F-HR filings for the given CIK, newest first.
// Walks the /submissions feed and picks up to N filings with form
// "13F-HR" or "13F-HR/A", ignoring 13F-NT (notice of other filer). The
// info table URL is resolved eagerly for each, so callers can move
// straight to parseInformationTable.
export async function fetchRecentThirteenFFilings(
  cik: string,
  maxCount: number,
): Promise<ThirteenFFilingRef[]> {
  const cik10 = padCik(cik);
  const res = await fetch(SUBMISSIONS_URL(cik10), {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `13F submissions fetch failed for CIK${cik10}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as RawSubmissionsResponse;
  const recent = data.filings?.recent;
  if (!recent) return [];

  const accessions = recent.accessionNumber ?? [];
  const forms = recent.form ?? [];
  const filingDates = recent.filingDate ?? [];
  const reportDates = recent.reportDate ?? [];
  const primaryDocs = recent.primaryDocument ?? [];

  const n = Math.min(
    accessions.length,
    forms.length,
    filingDates.length,
    reportDates.length,
  );

  const out: ThirteenFFilingRef[] = [];
  for (let i = 0; i < n && out.length < maxCount; i++) {
    const form = forms[i];
    if (form !== "13F-HR" && form !== "13F-HR/A") continue;
    const accession = accessions[i];
    const infoTableUrl = await resolveInfoTableUrl(cik10, accession);
    out.push({
      accession,
      form,
      filingDate: filingDates[i],
      periodOfReport: reportDates[i],
      primaryDocument: primaryDocs[i] ?? "",
      infoTableUrl,
    });
  }
  return out;
}

// 13F filings have multiple files in the accession archive: a narrative
// "primary_doc.xml" and the holdings XML (usually "informationtable.xml"
// or "form13fInfoTable.xml" depending on the filer). We pull the index
// JSON and pick the one flagged "INFORMATION TABLE" (reliable field when
// populated); fallback to any .xml that isn't primary_doc.
async function resolveInfoTableUrl(
  cik10: string,
  accession: string,
): Promise<string> {
  const cikNoZeros = cik10.replace(/^0+/, "") || "0";
  const accNoDashes = accession.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accNoDashes}/index.json`;

  const res = await fetch(indexUrl, {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `13F filing index fetch failed (${accession}): ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as {
    directory?: { item?: { name: string; type?: string }[] };
  };
  const items = data.directory?.item ?? [];

  // Preferred: type === "INFORMATION TABLE"
  let pick =
    items.find(
      (it) => (it.type ?? "").toUpperCase() === "INFORMATION TABLE",
    )?.name ?? null;

  // Fallback: first .xml that isn't primary_doc / ownership schedule
  if (!pick) {
    pick =
      items.find((it) => {
        const n = it.name.toLowerCase();
        return (
          n.endsWith(".xml") &&
          n !== "primary_doc.xml" &&
          !n.includes("primary_doc")
        );
      })?.name ?? null;
  }

  if (!pick) {
    throw new Error(
      `No information table XML found in filing ${accession}`,
    );
  }

  return `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accNoDashes}/${pick}`;
}

// Fetch + parse the information table for a filing. Returns the raw
// holdings array plus aggregate stats (total value, count) for the
// caller to persist alongside.
export async function parseInformationTable(
  infoTableUrl: string,
): Promise<{
  holdings: ThirteenFHolding[];
  totalValueUsd: number;
  holdingsCount: number;
}> {
  const res = await fetch(infoTableUrl, {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Info table fetch failed (${infoTableUrl}): ${res.status} ${res.statusText}`,
    );
  }
  const xml = await res.text();
  const holdings = parseInfoTableXml(xml);
  const totalValueUsd = holdings.reduce((sum, h) => sum + h.value_usd, 0);
  return {
    holdings,
    totalValueUsd,
    holdingsCount: holdings.length,
  };
}

// Pure: XML string → holdings array. Tolerant of namespace prefixes
// (`ns1:`, `n1:`, none) that vary between filers.
//
// Value unit detection: SEC amended Form 13F in 2022 to require whole
// dollars (previously thousands). Most filers migrated, some didn't.
// We detect per filing by computing implied share price (value/shares)
// across holdings: no legitimate stock trades above ~$10k/share
// outside BRK.A ($600k+), so if the median implied price is >$10k,
// the filing reports in whole dollars and we leave values as-is.
// Below $10k → values are in thousands, multiply by 1000.
export function parseInfoTableXml(xml: string): ThirteenFHolding[] {
  type RawHolding = {
    cusip: string;
    issuer_name: string;
    class_title: string | null;
    shares: bigint;
    raw_value: number;
    shares_type: "SH" | "PRN";
  };

  const raw: RawHolding[] = [];
  const blockRe = /<(?:[a-z0-9]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?infoTable>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[1];
    const issuer = readTag(block, "nameOfIssuer");
    const cusip = readTag(block, "cusip");
    const value = readTag(block, "value");
    const shares = readTag(block, "sshPrnamt");
    const sharesType = (readTag(block, "sshPrnamtType") ?? "SH").toUpperCase();
    const classTitle = readTag(block, "titleOfClass");

    if (sharesType !== "SH" && sharesType !== "PRN") continue;
    if (!issuer || !cusip || !value || !shares) continue;

    const sharesClean = shares.replace(/[^\d]/g, "");
    const valueClean = value.replace(/[^\d.]/g, "");
    if (!sharesClean || !valueClean) continue;

    raw.push({
      cusip: cusip.trim().toUpperCase().padStart(9, "0").slice(-9),
      issuer_name: issuer.trim(),
      class_title: classTitle ? classTitle.trim() : null,
      shares: BigInt(sharesClean),
      raw_value: Number(valueClean),
      shares_type: sharesType as "SH" | "PRN",
    });
  }

  // Decide thousands vs. whole-dollars by looking at implied share
  // price across common-share positions with non-zero shares. We use
  // the median (robust to a couple of misparsed rows) rather than
  // the mean.
  const impliedPrices = raw
    .filter((h) => h.shares_type === "SH" && h.shares > BigInt(0))
    .map((h) => h.raw_value / Number(h.shares))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  let valueInThousands = true;
  if (impliedPrices.length > 0) {
    const median =
      impliedPrices[Math.floor(impliedPrices.length / 2)];
    // Whole-dollars: median implied price = real share price, in the
    // $5-500 range for typical US equities. Thousands-mode divides
    // that by 1000, so implied prices land at $0.005-0.5. Threshold
    // 2.0 separates them cleanly (normal stock prices almost never
    // fall below $2, and thousands-mode almost never reaches it).
    if (median > 2.0) valueInThousands = false;
  }

  const multiplier = valueInThousands ? 1000 : 1;

  return raw.map((h) => ({
    cusip: h.cusip,
    issuer_name: h.issuer_name,
    class_title: h.class_title,
    shares: h.shares,
    value_usd: h.raw_value * multiplier,
    shares_type: h.shares_type,
  }));
}

function readTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${tag}>`,
    "i",
  );
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function padCik(cik: string): string {
  return cik.replace(/^0+/, "").padStart(10, "0");
}

// -----------------------------------------------------------------------
// Internal SEC submissions response shape (subset — only fields used).
// -----------------------------------------------------------------------

type RawSubmissionsResponse = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
    };
  };
};
