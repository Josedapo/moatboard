// Query layer for the insider_transactions table. Feeds the Calidad
// tab card on the position page. Signals in the Inbox come from the
// cron pipeline (form4Flow.ts), not from here.

import { sql } from "@/lib/db";

export type InsiderPurchaseRow = {
  transaction_date: string;           // YYYY-MM-DD
  reporting_owner_name: string;
  reporting_owner_title: string | null;
  is_officer: boolean;
  is_director: boolean;
  is_ten_percent_owner: boolean;
  shares: number;
  price_per_share: number;
  transaction_value_usd: number;
  rule10b5_1_flag: boolean | null;
  direct_or_indirect: "D" | "I";
};

export type InsiderSummary = {
  window_days: number;
  transaction_count: number;
  insider_count: number; // distinct reporting_owner_cik
  total_value_usd: number;
  any_rule10b5_1: boolean;
  top_transactions: InsiderPurchaseRow[];
};

// Filter matches the one form4Flow uses to emit signals:
//   code=P, acquired (A), not 10b5-1, value>=$50k OR CEO/CFO title.
// Kept in the query so the card is consistent with what the Inbox
// surfaced. `valueThreshold` overridable for UI tweaks.
export async function summarizeRecentInsiderPurchases({
  ticker,
  sinceDays = 90,
  valueThreshold = 50_000,
  topN = 5,
}: {
  ticker: string;
  sinceDays?: number;
  valueThreshold?: number;
  topN?: number;
}): Promise<InsiderSummary> {
  const rows = (await sql`
    SELECT
      TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
      reporting_owner_cik,
      reporting_owner_name,
      reporting_owner_title,
      is_officer,
      is_director,
      is_ten_percent_owner,
      shares::float AS shares,
      price_per_share::float AS price_per_share,
      transaction_value_usd::float AS transaction_value_usd,
      rule10b5_1_flag,
      direct_or_indirect
    FROM insider_transactions
    WHERE ticker = ${ticker.toUpperCase()}
      AND transaction_date >= (NOW() - (${sinceDays} || ' days')::INTERVAL)
      AND transaction_code = 'P'
      AND acquired_disposed = 'A'
      AND (rule10b5_1_flag IS NOT TRUE)
      AND (
        transaction_value_usd >= ${valueThreshold}
        OR reporting_owner_title ~* 'chief executive|ceo|chief financial|cfo'
      )
    ORDER BY transaction_date DESC, transaction_value_usd DESC
  `) as unknown as Array<
    InsiderPurchaseRow & { reporting_owner_cik: string }
  >;

  const distinctOwners = new Set<string>();
  let totalValueUsd = 0;
  let anyRule10b5_1 = false;
  for (const r of rows) {
    distinctOwners.add(r.reporting_owner_cik);
    totalValueUsd += r.transaction_value_usd;
    if (r.rule10b5_1_flag === true) anyRule10b5_1 = true;
  }

  const top = rows.slice(0, topN).map((r) => ({
    transaction_date: r.transaction_date,
    reporting_owner_name: r.reporting_owner_name,
    reporting_owner_title: r.reporting_owner_title,
    is_officer: r.is_officer,
    is_director: r.is_director,
    is_ten_percent_owner: r.is_ten_percent_owner,
    shares: r.shares,
    price_per_share: r.price_per_share,
    transaction_value_usd: r.transaction_value_usd,
    rule10b5_1_flag: r.rule10b5_1_flag,
    direct_or_indirect: r.direct_or_indirect,
  }));

  return {
    window_days: sinceDays,
    transaction_count: rows.length,
    insider_count: distinctOwners.size,
    total_value_usd: totalValueUsd,
    any_rule10b5_1: anyRule10b5_1,
    top_transactions: top,
  };
}
