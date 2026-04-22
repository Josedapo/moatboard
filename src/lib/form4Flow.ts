// Form 4 orchestrator. For a (user, ticker) pair, fetches recent Form 4
// filings, parses each XML, persists every transaction in
// `insider_transactions`, and emits a `review_signals` row when at
// least one transaction in a filing passes the open-market-purchase
// filter (code=P, not 10b5-1, value>=$50k OR insider is CEO/CFO).
//
// Idempotency:
//   - insider_transactions: UNIQUE(accession, transaction_index), INSERT
//     DO NOTHING. Re-running the cron re-iterates the same filings but
//     the DB is unchanged once they're already stored.
//   - review_signals: deduplication_key = `insider-${accession}`. One
//     signal per filing, regardless of how many transactions were in it.

import { sql } from "@/lib/db";
import {
  fetchRecentFilings,
  buildFilingUrl,
  buildForm4RawXmlUrl,
} from "@/lib/secFilings";
import { fetchFilingRawXml } from "@/lib/secDocument";
import {
  parseForm4Xml,
  isCeoOrCfo,
  type Form4Transaction,
  type ParsedForm4,
} from "@/lib/form4Parser";
import { createSignalIfMissing } from "@/lib/reviewSignals";

export type EnsureInsiderSignalsResult = {
  ticker: string;
  form4sScanned: number;
  transactionsInserted: number;
  signalsInserted: number;
  errored: boolean;
  errorMessage?: string;
};

const PURCHASE_VALUE_THRESHOLD_USD = 50_000;

// Does any non-derivative transaction in the parsed filing qualify as a
// material open-market purchase worth emitting a signal for?
function filingHasQualifyingPurchase(parsed: ParsedForm4): boolean {
  for (const t of parsed.nonDerivativeTransactions) {
    if (t.transactionCode !== "P") continue;
    if (t.acquiredDisposed !== "A") continue;
    if (t.rule10b5_1Flag === true) continue; // explicit plan → skip
    const valueUsd = t.shares * t.pricePerShare;
    if (
      valueUsd >= PURCHASE_VALUE_THRESHOLD_USD ||
      isCeoOrCfo(parsed.reportingOwnerTitle)
    ) {
      return true;
    }
  }
  return false;
}

// Summary payload attached to the review_signals row. Keeps just the
// transactions that qualified; the card in the Inbox renders this
// directly (no extra query).
type SignalTransactionPayload = {
  transaction_date: string;
  shares: number;
  price_per_share: number;
  value_usd: number;
  direct_or_indirect: "D" | "I";
  rule10b5_1_flag: boolean | null;
};

function buildSignalPayload(parsed: ParsedForm4): {
  transactions: SignalTransactionPayload[];
  total_value_usd: number;
} {
  const transactions: SignalTransactionPayload[] = [];
  let total = 0;
  for (const t of parsed.nonDerivativeTransactions) {
    if (t.transactionCode !== "P") continue;
    if (t.acquiredDisposed !== "A") continue;
    if (t.rule10b5_1Flag === true) continue;
    const valueUsd = t.shares * t.pricePerShare;
    transactions.push({
      transaction_date: t.transactionDate,
      shares: t.shares,
      price_per_share: t.pricePerShare,
      value_usd: valueUsd,
      direct_or_indirect: t.directOrIndirect,
      rule10b5_1_flag: t.rule10b5_1Flag,
    });
    total += valueUsd;
  }
  return { transactions, total_value_usd: total };
}

// Persist every non-derivative transaction of a parsed Form 4. Idempotent
// at the DB level via UNIQUE(accession, transaction_index). Returns the
// number of rows actually inserted.
async function persistTransactions({
  parsed,
  ticker,
  accession,
  filingDate,
}: {
  parsed: ParsedForm4;
  ticker: string;
  accession: string;
  filingDate: string;
}): Promise<number> {
  let inserted = 0;
  for (
    let idx = 0;
    idx < parsed.nonDerivativeTransactions.length;
    idx += 1
  ) {
    const t = parsed.nonDerivativeTransactions[idx];
    const rows = (await sql`
      INSERT INTO insider_transactions (
        ticker, issuer_cik, accession, filing_date, transaction_date,
        transaction_index, reporting_owner_cik, reporting_owner_name,
        reporting_owner_title, is_officer, is_director, is_ten_percent_owner,
        transaction_code, acquired_disposed, shares, price_per_share,
        rule10b5_1_flag, direct_or_indirect
      ) VALUES (
        ${ticker.toUpperCase()}, ${parsed.issuerCik}, ${accession},
        ${filingDate}, ${t.transactionDate}, ${idx},
        ${parsed.reportingOwnerCik}, ${parsed.reportingOwnerName},
        ${parsed.reportingOwnerTitle}, ${parsed.isOfficer},
        ${parsed.isDirector}, ${parsed.isTenPercentOwner},
        ${t.transactionCode}, ${t.acquiredDisposed},
        ${t.shares}, ${t.pricePerShare},
        ${t.rule10b5_1Flag}, ${t.directOrIndirect}
      )
      ON CONFLICT (accession, transaction_index) DO NOTHING
      RETURNING id
    `) as unknown as { id: number }[];
    if (rows.length > 0) inserted += 1;
  }
  return inserted;
}

export async function ensureInsiderSignalsForTicker({
  userId,
  ticker,
  sinceDays = 180,
}: {
  userId: string | number;
  ticker: string;
  sinceDays?: number;
}): Promise<EnsureInsiderSignalsResult> {
  const result: EnsureInsiderSignalsResult = {
    ticker,
    form4sScanned: 0,
    transactionsInserted: 0,
    signalsInserted: 0,
    errored: false,
  };

  try {
    const filings = await fetchRecentFilings(ticker, { sinceDays });
    if (filings === null) {
      // No CIK — foreign listing or out-of-sync map. Not an error.
      return result;
    }

    const form4s = filings.filter((f) => f.form === "4");
    result.form4sScanned = form4s.length;

    for (const filing of form4s) {
      try {
        const xml = await fetchFilingRawXml(buildForm4RawXmlUrl(filing));
        const parsed = parseForm4Xml(xml);

        const persisted = await persistTransactions({
          parsed,
          ticker,
          accession: filing.accession,
          filingDate: filing.filingDate,
        });
        result.transactionsInserted += persisted;

        if (!filingHasQualifyingPurchase(parsed)) continue;

        const payload = buildSignalPayload(parsed);
        if (payload.transactions.length === 0) continue;

        const inserted = await createSignalIfMissing({
          userId,
          ticker,
          source: "sec_form4",
          eventType: "insider_purchase",
          eventDate: filing.filingDate,
          sourceRef: filing.accession,
          sourceUrl: buildFilingUrl(filing),
          severity: "informational",
          rawPayload: {
            issuer_cik: parsed.issuerCik,
            issuer_name: parsed.issuerName,
            reporting_owner_name: parsed.reportingOwnerName,
            reporting_owner_title: parsed.reportingOwnerTitle,
            is_officer: parsed.isOfficer,
            is_director: parsed.isDirector,
            is_ten_percent_owner: parsed.isTenPercentOwner,
            transactions: payload.transactions,
            total_value_usd: payload.total_value_usd,
          },
          deduplicationKey: `insider-${filing.accession}`,
        });
        if (inserted) result.signalsInserted += 1;
      } catch (err) {
        // Per-filing failure isolated — keep going. A malformed XML on
        // one Form 4 shouldn't abort the rest of the ticker's filings.
        const msg = err instanceof Error ? err.message : "unknown error";
        result.errored = true;
        result.errorMessage = `${filing.accession}: ${msg}`;
      }
    }
  } catch (err) {
    result.errored = true;
    result.errorMessage =
      err instanceof Error ? err.message : "unknown error";
  }

  return result;
}
