import { sql } from "@/lib/db";

export type TransactionType = "buy" | "add" | "trim" | "sell";

export type PositionTransaction = {
  id: number;
  position_id: number;
  type: TransactionType;
  transaction_date: string; // YYYY-MM-DD
  price: string; // NUMERIC serialized as string by pg
  shares: string;
  pre_commitment_md: string | null;
  created_at: string;
};

export async function listTransactions(
  positionId: number,
): Promise<PositionTransaction[]> {
  const rows = (await sql`
    SELECT
      id,
      position_id,
      type,
      TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
      price,
      shares,
      pre_commitment_md,
      created_at
    FROM position_transactions
    WHERE position_id = ${positionId}
    ORDER BY transaction_date ASC, id ASC
  `) as unknown as PositionTransaction[];
  return rows;
}

export async function getTransactionById(
  id: number,
): Promise<PositionTransaction | null> {
  const rows = (await sql`
    SELECT
      id,
      position_id,
      type,
      TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
      price,
      shares,
      pre_commitment_md,
      created_at
    FROM position_transactions
    WHERE id = ${id}
    LIMIT 1
  `) as unknown as PositionTransaction[];
  return rows[0] ?? null;
}

export async function createTransaction({
  positionId,
  type,
  transactionDate,
  price,
  shares,
  preCommitmentMd,
}: {
  positionId: number;
  type: TransactionType;
  transactionDate: string;
  price: number;
  shares: number;
  preCommitmentMd?: string | null;
}): Promise<PositionTransaction> {
  const rows = (await sql`
    INSERT INTO position_transactions
      (position_id, type, transaction_date, price, shares, pre_commitment_md)
    VALUES
      (${positionId}, ${type}, ${transactionDate}, ${price}, ${shares}, ${preCommitmentMd ?? null})
    RETURNING
      id,
      position_id,
      type,
      TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
      price,
      shares,
      pre_commitment_md,
      created_at
  `) as unknown as PositionTransaction[];
  return rows[0];
}

export async function deleteTransaction(id: number): Promise<void> {
  await sql`DELETE FROM position_transactions WHERE id = ${id}`;
}

// Aggregate helpers — cost basis is derived, never stored.

export type CostBasis = {
  shares: number; // net shares held (buys + adds − trims − sells)
  invested: number; // dollars put in (buys + adds)
  withdrawn: number; // dollars taken out (trims + sells)
  avg_cost_per_share: number | null; // invested / total_bought_shares (nulls when no buys)
};

export async function getCostBasis(positionId: number): Promise<CostBasis> {
  const txns = await listTransactions(positionId);
  let sharesHeld = 0;
  let invested = 0;
  let withdrawn = 0;
  let boughtShares = 0;
  for (const txn of txns) {
    const price = Number(txn.price);
    const shares = Number(txn.shares);
    if (txn.type === "buy" || txn.type === "add") {
      sharesHeld += shares;
      invested += price * shares;
      boughtShares += shares;
    } else {
      sharesHeld -= shares;
      withdrawn += price * shares;
    }
  }
  return {
    shares: sharesHeld,
    invested,
    withdrawn,
    avg_cost_per_share: boughtShares > 0 ? invested / boughtShares : null,
  };
}
