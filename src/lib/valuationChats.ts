// CRUD for valuation_chats — Joseda's per-ticker conversation with
// Moatboard about a ticker's valuation. Durable across regenerations
// of the underlying `valuations` row; each turn snapshots the context
// it was asked under so the UI can render version dividers.

import { sql } from "@/lib/db";

// Snapshot of the valuation row at the moment of asking. Stored on
// every turn so old questions stay coherent when the math gets
// regenerated. Kept tight — only fields the UI shows in the version
// divider header. The full `assumptions` blob isn't needed here
// because old AI answers reference whatever they referenced; the
// snapshot is purely for visual context.
export type ChatTurnSnapshot = {
  iv_base: number;
  iv_low: number;
  iv_high: number;
  method: string;
  current_price: number;
  mos_pct: number;
};

export type ValuationChatTurn = {
  id: number;
  user_id: number;
  ticker: string;
  question: string;
  answer: string;
  asked_at: string;
  answered_with_model: string;
  snapshot: ChatTurnSnapshot;
};

export async function listChatTurnsForTicker({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<ValuationChatTurn[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, question, answer, asked_at,
           answered_with_model, snapshot
    FROM valuation_chats
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    ORDER BY asked_at ASC, id ASC
  `) as unknown as ValuationChatTurn[];
  return rows;
}

export async function appendChatTurn({
  userId,
  ticker,
  question,
  answer,
  model,
  snapshot,
  askedAt,
}: {
  userId: string | number;
  ticker: string;
  question: string;
  answer: string;
  model: string;
  snapshot: ChatTurnSnapshot;
  askedAt?: string; // ISO; only used by the seed script
}): Promise<ValuationChatTurn> {
  const rows = (await sql`
    INSERT INTO valuation_chats
      (user_id, ticker, question, answer, asked_at,
       answered_with_model, snapshot)
    VALUES
      (${userId}, ${ticker.toUpperCase()}, ${question}, ${answer},
       ${askedAt ?? new Date().toISOString()},
       ${model}, ${JSON.stringify(snapshot)}::jsonb)
    RETURNING id, user_id, ticker, question, answer, asked_at,
              answered_with_model, snapshot
  `) as unknown as ValuationChatTurn[];
  return rows[0];
}
