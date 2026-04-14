import { sql } from "@/lib/db";
import type { ThesisContent } from "@/lib/thesis";

export type ThesisSource = "user" | "ai";

export type Thesis = {
  id: number;
  position_id: number;
  source: ThesisSource;
  raw_text: string;
  structured_content: ThesisContent | null;
  created_at: string;
  edited_at: string | null;
};

export async function getThesisByPositionId(
  positionId: number,
): Promise<Thesis | null> {
  const rows = (await sql`
    SELECT id, position_id, source, raw_text, structured_content, created_at, edited_at
    FROM theses
    WHERE position_id = ${positionId}
    LIMIT 1
  `) as unknown as Thesis[];
  return rows[0] ?? null;
}

export async function saveAiThesis({
  positionId,
  rawText,
  structuredContent,
}: {
  positionId: number;
  rawText: string;
  structuredContent: ThesisContent;
}): Promise<Thesis> {
  const rows = (await sql`
    INSERT INTO theses (position_id, source, raw_text, structured_content)
    VALUES (${positionId}, 'ai', ${rawText}, ${JSON.stringify(structuredContent)})
    ON CONFLICT (position_id) DO UPDATE
      SET source = 'ai',
          raw_text = EXCLUDED.raw_text,
          structured_content = EXCLUDED.structured_content,
          created_at = NOW(),
          edited_at = NULL
    RETURNING id, position_id, source, raw_text, structured_content, created_at, edited_at
  `) as unknown as Thesis[];
  return rows[0];
}

export async function saveUserThesis({
  positionId,
  rawText,
}: {
  positionId: number;
  rawText: string;
}): Promise<Thesis> {
  const rows = (await sql`
    INSERT INTO theses (position_id, source, raw_text, structured_content)
    VALUES (${positionId}, 'user', ${rawText}, NULL)
    ON CONFLICT (position_id) DO UPDATE
      SET source = 'user',
          raw_text = EXCLUDED.raw_text,
          structured_content = NULL,
          edited_at = CASE
            WHEN theses.source = 'user' THEN NOW()
            ELSE NULL
          END,
          created_at = CASE
            WHEN theses.source = 'user' THEN theses.created_at
            ELSE NOW()
          END
    RETURNING id, position_id, source, raw_text, structured_content, created_at, edited_at
  `) as unknown as Thesis[];
  return rows[0];
}

export async function updateAiContent({
  thesisId,
  content,
}: {
  thesisId: number;
  content: ThesisContent;
}): Promise<void> {
  await sql`
    UPDATE theses
    SET structured_content = ${JSON.stringify(content)},
        edited_at = NOW()
    WHERE id = ${thesisId} AND source = 'ai'
  `;
}

export async function deleteThesis(positionId: number): Promise<void> {
  await sql`DELETE FROM theses WHERE position_id = ${positionId}`;
}
