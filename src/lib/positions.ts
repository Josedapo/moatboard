import { sql } from "@/lib/db";

export type Position = {
  id: number;
  user_id: number;
  ticker: string;
  purchase_price: string;
  purchase_date: string;
  created_at: string;
};

export async function getPositionsByUserId(userId: string | number): Promise<Position[]> {
  const rows = (await sql`
    SELECT
      id,
      user_id,
      ticker,
      purchase_price,
      TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
      created_at
    FROM positions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `) as unknown as Position[];
  return rows;
}

export async function createPosition({
  userId,
  ticker,
  purchasePrice,
  purchaseDate,
}: {
  userId: string | number;
  ticker: string;
  purchasePrice: number;
  purchaseDate: string;
}): Promise<Position> {
  const rows = (await sql`
    INSERT INTO positions (user_id, ticker, purchase_price, purchase_date)
    VALUES (${userId}, ${ticker.toUpperCase()}, ${purchasePrice}, ${purchaseDate})
    RETURNING
      id,
      user_id,
      ticker,
      purchase_price,
      TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
      created_at
  `) as unknown as Position[];
  return rows[0];
}

export async function deletePosition(
  positionId: number,
  userId: string | number,
): Promise<void> {
  await sql`
    DELETE FROM positions
    WHERE id = ${positionId} AND user_id = ${userId}
  `;
}

export async function countPositionsByUserId(userId: string | number): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(*)::INTEGER AS count FROM positions WHERE user_id = ${userId}
  `) as unknown as { count: number }[];
  return rows[0].count;
}

export async function getPositionById(
  positionId: number,
  userId: string | number,
): Promise<Position | null> {
  const rows = (await sql`
    SELECT
      id,
      user_id,
      ticker,
      purchase_price,
      TO_CHAR(purchase_date, 'YYYY-MM-DD') AS purchase_date,
      created_at
    FROM positions
    WHERE id = ${positionId} AND user_id = ${userId}
    LIMIT 1
  `) as unknown as Position[];
  return rows[0] ?? null;
}
