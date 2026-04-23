import { sql } from "@/lib/db";

// A position is the container for a user's ownership of a ticker. Cost basis,
// purchase dates, and share counts live in `position_transactions` (one row
// per buy / add / trim / sell) and are derived, never stored here.
//
// `pre_commitment_md` is the position-level "what would make me lose
// confidence" anchor — set once (optional) at first buy, editable later from
// the position page. Distinct from `position_transactions.pre_commitment_md`
// which is the per-operation note ("why this buy").
export type Position = {
  id: number;
  user_id: number;
  ticker: string;
  pre_commitment_md: string | null;
  pre_commitment_edited_at: string | null;
  created_at: string;
};

const POSITION_COLUMNS = `
  id, user_id, ticker, pre_commitment_md, pre_commitment_edited_at, created_at
`;

// Returns "live" positions only — net shares > 0 (buys + adds − trims −
// sells). Drafts (no transactions) are excluded automatically because their
// net is 0. Closed positions (sold to zero) are also excluded — they live
// in /dashboard/history via ticker_states='discarded'. The position page is
// still reachable by direct URL so the trail isn't lost.
export async function getPositionsByUserId(
  userId: string | number,
): Promise<Position[]> {
  const rows = (await sql`
    SELECT p.id, p.user_id, p.ticker, p.pre_commitment_md, p.pre_commitment_edited_at, p.created_at
    FROM positions p
    WHERE p.user_id = ${userId}
      AND COALESCE((
        SELECT SUM(
          CASE WHEN t.type IN ('buy', 'add') THEN t.shares ELSE -t.shares END
        )
        FROM position_transactions t
        WHERE t.position_id = p.id
      ), 0) > 0
    ORDER BY p.created_at DESC
  `) as unknown as Position[];
  return rows;
}

// Returns the user's draft (transactionless) position for a ticker if one
// exists — used by the analysis wizard to resume an in-progress analysis.
export async function getDraftPositionByTicker(
  userId: string | number,
  ticker: string,
): Promise<Position | null> {
  const rows = (await sql`
    SELECT p.id, p.user_id, p.ticker, p.pre_commitment_md, p.pre_commitment_edited_at, p.created_at
    FROM positions p
    WHERE p.user_id = ${userId}
      AND p.ticker = ${ticker.toUpperCase()}
      AND NOT EXISTS (
        SELECT 1 FROM position_transactions t WHERE t.position_id = p.id
      )
    LIMIT 1
  `) as unknown as Position[];
  return rows[0] ?? null;
}

export async function getPositionById(
  positionId: number,
  userId: string | number,
): Promise<Position | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, pre_commitment_md, pre_commitment_edited_at, created_at
    FROM positions
    WHERE id = ${positionId} AND user_id = ${userId}
    LIMIT 1
  `) as unknown as Position[];
  return rows[0] ?? null;
}

export async function getPositionByTicker(
  userId: string | number,
  ticker: string,
): Promise<Position | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, pre_commitment_md, pre_commitment_edited_at, created_at
    FROM positions
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    LIMIT 1
  `) as unknown as Position[];
  return rows[0] ?? null;
}

// Map of ticker → position_id for every position the user has ever held
// (i.e. has at least one transaction). Includes closed positions (net
// shares = 0) — used by the History page to show "Open ficha" on Discarded
// items that were once owned, distinguishing them from never-bought
// discards.
export async function listLivedPositionIdsByTicker(
  userId: string | number,
): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT p.id, p.ticker
    FROM positions p
    WHERE p.user_id = ${userId}
      AND EXISTS (
        SELECT 1 FROM position_transactions t WHERE t.position_id = p.id
      )
  `) as unknown as { id: number; ticker: string }[];
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.ticker, row.id);
  return map;
}

// Creates an empty position record. Rare — most callers want the "with first
// buy" atomic variant below, which records the purchase at the same time.
export async function createPosition({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<Position> {
  const rows = (await sql`
    INSERT INTO positions (user_id, ticker)
    VALUES (${userId}, ${ticker.toUpperCase()})
    RETURNING id, user_id, ticker, pre_commitment_md, pre_commitment_edited_at, created_at
  `) as unknown as Position[];
  return rows[0];
}

// Get-or-create a draft position for a ticker the user is currently
// watching (watchlist ficha). Lets the scorecard + valuation views
// hang off a real position_id so the existing ensureAnalysis /
// ensureValuation infrastructure works unchanged. Drafts have no
// transactions so they stay hidden from the Dashboard (which filters
// by `EXISTS transactions`), and the same draft is reused if the user
// later promotes the ticker to "in_portfolio" via the wizard.
export async function ensureDraftPosition(
  userId: string | number,
  ticker: string,
): Promise<Position> {
  const existing = await getDraftPositionByTicker(userId, ticker);
  if (existing) return existing;
  return createPosition({ userId, ticker });
}

// Creates the position AND its first buy transaction in a single CTE so the
// two rows are always consistent. If UNIQUE(user_id, ticker) fires (user
// already has a position in this ticker), Postgres raises and the caller
// should handle the duplicate case separately.
export async function createPositionWithFirstBuy({
  userId,
  ticker,
  purchasePrice,
  purchaseDate,
  shares,
  preCommitmentMd,
}: {
  userId: string | number;
  ticker: string;
  purchasePrice: number;
  purchaseDate: string; // YYYY-MM-DD
  shares: number;
  preCommitmentMd?: string | null;
}): Promise<{ position: Position; transactionId: number }> {
  const rows = (await sql`
    WITH new_position AS (
      INSERT INTO positions (user_id, ticker)
      VALUES (${userId}, ${ticker.toUpperCase()})
      RETURNING id, user_id, ticker, pre_commitment_md, pre_commitment_edited_at, created_at
    ),
    new_txn AS (
      INSERT INTO position_transactions
        (position_id, type, transaction_date, price, shares, pre_commitment_md)
      SELECT id, 'buy', ${purchaseDate}, ${purchasePrice}, ${shares}, ${preCommitmentMd ?? null}
      FROM new_position
      RETURNING id AS transaction_id, position_id
    )
    SELECT np.id, np.user_id, np.ticker, np.pre_commitment_md, np.pre_commitment_edited_at, np.created_at, nt.transaction_id
    FROM new_position np
    JOIN new_txn nt ON nt.position_id = np.id
  `) as unknown as (Position & { transaction_id: number })[];
  const row = rows[0];
  return {
    position: {
      id: row.id,
      user_id: row.user_id,
      ticker: row.ticker,
      pre_commitment_md: row.pre_commitment_md,
      pre_commitment_edited_at: row.pre_commitment_edited_at,
      created_at: row.created_at,
    },
    transactionId: row.transaction_id,
  };
}

// Update the position-level pre-commitment. Empty string clears it. The
// edited timestamp is bumped on every call so the UI can show "Editado el…".
export async function updatePositionPreCommitment({
  positionId,
  userId,
  text,
}: {
  positionId: number;
  userId: string | number;
  text: string | null;
}): Promise<void> {
  const trimmed = text?.trim() ?? null;
  const value = trimmed && trimmed.length > 0 ? trimmed : null;
  await sql`
    UPDATE positions
    SET pre_commitment_md = ${value},
        pre_commitment_edited_at = NOW()
    WHERE id = ${positionId} AND user_id = ${userId}
  `;
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

export async function countPositionsByUserId(
  userId: string | number,
): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(*)::INTEGER AS count FROM positions WHERE user_id = ${userId}
  `) as unknown as { count: number }[];
  return rows[0].count;
}
