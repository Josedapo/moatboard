// Shared helpers for working with SEC EDGAR primary document HTML.
// Extracted from signalSummaryAi.ts so the same pipeline (fetch →
// strip HTML → truncate) can feed other AI generators (business
// understanding, red flags, future DEF 14A / 10-Q consumers).
//
// Design:
//   - stripHtml is pure (no I/O). Takes raw HTML, returns plain text.
//   - fetchFilingText hits EDGAR with the required User-Agent, cleans,
//     and truncates. `preserve` chooses which end of the document to
//     keep when truncating (start = discards tail; end = discards head).
//   - extractItem1A is a best-effort regex slicer for 10-K Item 1A
//     Risk Factors. Returns null when the slice doesn't look right;
//     callers fall back to the full truncated document.

const SEC_USER_AGENT = process.env.SEC_USER_AGENT;
if (!SEC_USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is not set. SEC EDGAR requires 'Name Email' format.",
  );
}

// Sonnet 4.6 has a 200k-token context window. ~550k chars of English
// leaves comfortable room for prompt + output. Same value the signal
// summariser used before the extraction.
export const MAX_DOCUMENT_CHARS_START = 550_000;

// For Item-1A fallback (truncate from the end of the 10-K so risk
// factors — which sit after Item 1 Business — survive). Smaller than
// the start cap because we only need Items 1A-3, not the whole filing.
export const MAX_DOCUMENT_CHARS_END = 400_000;

// Minimum viable size for a 1A slice. Below this we assume the regex
// matched something off and we fall back to the end-truncated doc.
const ITEM_1A_MIN_CHARS = 20_000;

// Upper bound — if the "1A → 1B/Item 2" slice comes back huge, the
// end anchor probably failed and we captured half the filing.
const ITEM_1A_MAX_CHARS = 400_000;

export type FilingText = {
  text: string;
  truncated: boolean;
  preserved: "start" | "end";
};

// Download the primary filing document from EDGAR and strip the HTML
// shell down to something Claude can read. Minimal cleaning on purpose
// — we remove scripts/styles and collapse whitespace but keep the
// semantic text (headings, paragraphs, tables as plain text). No DOM
// parser dependency; SEC filings are well-formed enough for regex.
export async function fetchFilingText(
  url: string,
  options: { preserve?: "start" | "end"; maxChars?: number } = {},
): Promise<FilingText> {
  const preserve = options.preserve ?? "start";
  const maxChars =
    options.maxChars ??
    (preserve === "start" ? MAX_DOCUMENT_CHARS_START : MAX_DOCUMENT_CHARS_END);

  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `SEC document fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const raw = await res.text();
  const cleaned = stripHtml(raw);

  const truncated = cleaned.length > maxChars;
  const text = truncated
    ? preserve === "start"
      ? cleaned.slice(0, maxChars)
      : cleaned.slice(-maxChars)
    : cleaned;

  return { text, truncated, preserved: preserve };
}

// Pure HTML-to-plain-text. SEC filings use inline XBRL + tables
// heavily; the regex approach has been validated in production on
// 10-K/10-Q/8-K docs.
export function stripHtml(raw: string): string {
  // Strip <script> and <style> blocks including their content.
  let cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "");

  // Replace closing block tags with newlines so structure survives.
  cleaned = cleaned.replace(
    /<\/(p|div|tr|li|h[1-6]|section|article|header|footer)>/gi,
    "\n",
  );

  // Strip every remaining tag.
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Decode a handful of common HTML entities. Not exhaustive but covers
  // what SEC filings use in 99% of cases.
  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse whitespace (including newlines between tags) into single
  // spaces, then restore paragraph breaks for the double-newlines we
  // introduced on block-close tags.
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/\n +/g, "\n").replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

// Best-effort extractor for Item 1A (Risk Factors). Returns null when
// the slice doesn't look right — callers should then fall back to the
// end-truncated full document.
//
// 10-K layouts vary (Item 1A sometimes followed by Unresolved Staff
// Comments / Cybersecurity / Properties), so we accept the first of
// several plausible end anchors.
export function extractItem1A(text: string): string | null {
  const startRe =
    /(?:^|\n)\s*item\s*1a\.?\s*(?:[—-]\s*)?risk\s+factors/i;
  const startMatch = startRe.exec(text);
  if (!startMatch) return null;
  const sliceFrom = startMatch.index;

  // Look for the next Item header after 1A. Common anchors: 1B
  // (Unresolved Staff Comments), 1C (Cybersecurity — post-2023
  // filings), 2 (Properties), 3 (Legal Proceedings).
  const endRe =
    /\n\s*item\s*(?:1b\.?|1c\.?|2\.?\s*properties|3\.?\s*legal\s+proceedings)/i;
  const remainder = text.slice(sliceFrom + startMatch[0].length);
  const endMatch = endRe.exec(remainder);
  if (!endMatch) return null;

  const sliceTo = sliceFrom + startMatch[0].length + endMatch.index;
  const candidate = text.slice(sliceFrom, sliceTo).trim();

  if (candidate.length < ITEM_1A_MIN_CHARS) return null;
  if (candidate.length > ITEM_1A_MAX_CHARS) return null;
  return candidate;
}
