// Orchestrators that fetch + prepare the latest 10-K text as prompt
// input for the Understanding / Red flags generators. Each returns
// null when SEC is unreachable or the ticker has no annual filing —
// callers fall back to generation without filing grounding.

import { fetchLatestAnnualFiling } from "@/lib/secFilings";
import {
  fetchFilingText,
  extractItem1A,
  MAX_DOCUMENT_CHARS_END,
} from "@/lib/secDocument";
import type { UnderstandingFilingInput } from "@/lib/businessUnderstandingAi";
import type { RedFlagsFilingInput } from "@/lib/redFlagsAi";
import type { MoatFilingInput } from "@/lib/moatAi";

const MIN_USABLE_CHARS = 5_000;

// Understanding prompt wants Item 1 (Business description). Truncate
// from the start — Item 1 lives in the first 50-150k chars of any
// 10-K, so the default start-preserving cap is the right call.
export async function prepareUnderstandingFiling(
  ticker: string,
): Promise<UnderstandingFilingInput | null> {
  const filing = await fetchLatestAnnualFiling(ticker);
  if (!filing) return null;

  try {
    const { text, truncated } = await fetchFilingText(filing.url, {
      preserve: "start",
    });
    if (!text || text.length < MIN_USABLE_CHARS) return null;

    return {
      text,
      truncated,
      accession: filing.accession,
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      url: filing.url,
    };
  } catch (err) {
    console.error(
      `prepareUnderstandingFiling: ${ticker} filing fetch failed: ${(err as Error).message}`,
    );
    return null;
  }
}

// Moat assessment wants Item 1 (Business description) — the canonical
// place where management describes how the company actually competes
// (customers, suppliers, distribution, technology, regulation, brand,
// scale). Item 1 lives at the start of any 10-K, so the same start-
// preserving truncation that Understanding uses is the right call.
// Returning the same shape as the Understanding filing (kept as a
// distinct type so future divergence — e.g. larger window for moat —
// stays cheap).
export async function prepareMoatFiling(
  ticker: string,
): Promise<MoatFilingInput | null> {
  const filing = await fetchLatestAnnualFiling(ticker);
  if (!filing) return null;

  try {
    const { text, truncated } = await fetchFilingText(filing.url, {
      preserve: "start",
    });
    if (!text || text.length < MIN_USABLE_CHARS) return null;

    return {
      text,
      truncated,
      accession: filing.accession,
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      url: filing.url,
    };
  } catch (err) {
    console.error(
      `prepareMoatFiling: ${ticker} filing fetch failed: ${(err as Error).message}`,
    );
    return null;
  }
}

// Red flags wants Item 1A (Risk Factors). First try to extract 1A
// surgically from the full cleaned text — if the regex finds a
// reasonable slice, use just that and tag source='item_1a'. If not,
// fall back to the end-truncated full filing (Items 1A / 2 / 3 are
// preserved; Items 1 + prelude are cut).
export async function prepareRedFlagsFiling(
  ticker: string,
): Promise<RedFlagsFilingInput | null> {
  const filing = await fetchLatestAnnualFiling(ticker);
  if (!filing) return null;

  try {
    // Fetch a generous start-preserving read first so we have the
    // whole 10-K in memory; the extractor walks the text to find 1A.
    const wideRead = await fetchFilingText(filing.url, {
      preserve: "start",
      maxChars: 2_000_000, // big enough to hold most 10-Ks end-to-end
    });
    if (!wideRead.text || wideRead.text.length < MIN_USABLE_CHARS) return null;

    const item1A = extractItem1A(wideRead.text);
    if (item1A) {
      return {
        text: item1A,
        truncated: false,
        source: "item_1a",
        accession: filing.accession,
        form: filing.form,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        url: filing.url,
      };
    }

    // Fallback: preserve the end of the filing (risk factors / legal
    // proceedings / MD&A live after Item 1 Business).
    const endText =
      wideRead.text.length > MAX_DOCUMENT_CHARS_END
        ? wideRead.text.slice(-MAX_DOCUMENT_CHARS_END)
        : wideRead.text;

    return {
      text: endText,
      truncated: wideRead.text.length > MAX_DOCUMENT_CHARS_END,
      source: "full_truncated_end",
      accession: filing.accession,
      form: filing.form,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      url: filing.url,
    };
  } catch (err) {
    console.error(
      `prepareRedFlagsFiling: ${ticker} filing fetch failed: ${(err as Error).message}`,
    );
    return null;
  }
}
