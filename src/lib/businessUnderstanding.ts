import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";

// A single Q&A entry. `pregenerated` are the 5-7 common questions the AI
// pre-answers with the summary; `user_followup` are questions the user asked
// in the chat after reading the summary.
export type QnA = {
  question: string;
  answer: string;
  type: "pregenerated" | "user_followup";
  created_at?: string; // ISO; only present on user_followup
};

export type BusinessUnderstandingSource = {
  url: string;
  label: string;
  type: "10k" | "10q" | "earnings_call" | "other";
};

export type BusinessUnderstanding = {
  ticker: string;
  version: number;
  summary_md: string;
  questions_and_answers: QnA[];
  sources: BusinessUnderstandingSource[];
  generated_at: string;
  generated_with_model: string;
  archived_at: string | null;
  last_10k_accession: string | null;
  last_10k_period_end: string | null; // YYYY-MM-DD
};

const UNDERSTANDING_COLUMNS = `
  ticker, version, summary_md, questions_and_answers, sources,
  generated_at, generated_with_model, archived_at,
  last_10k_accession,
  TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end
`;

export async function getCurrentUnderstanding(
  ticker: string,
): Promise<BusinessUnderstanding | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, version, summary_md, questions_and_answers, sources,
           generated_at, generated_with_model, archived_at,
           last_10k_accession,
           TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end
    FROM business_understanding
    WHERE ticker = ${canonical} AND archived_at IS NULL
    ORDER BY version DESC
    LIMIT 1
  `) as unknown as BusinessUnderstanding[];
  return rows[0] ?? null;
}

export async function getUnderstandingVersion(
  ticker: string,
  version: number,
): Promise<BusinessUnderstanding | null> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, version, summary_md, questions_and_answers, sources,
           generated_at, generated_with_model, archived_at,
           last_10k_accession,
           TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end
    FROM business_understanding
    WHERE ticker = ${canonical} AND version = ${version}
    LIMIT 1
  `) as unknown as BusinessUnderstanding[];
  return rows[0] ?? null;
}

export async function listUnderstandingVersions(
  ticker: string,
): Promise<BusinessUnderstanding[]> {
  const canonical = await getCanonicalTicker(ticker);
  const rows = (await sql`
    SELECT ticker, version, summary_md, questions_and_answers, sources,
           generated_at, generated_with_model, archived_at,
           last_10k_accession,
           TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end
    FROM business_understanding
    WHERE ticker = ${canonical}
    ORDER BY version DESC
  `) as unknown as BusinessUnderstanding[];
  return rows;
}

void UNDERSTANDING_COLUMNS;

// Creates a new version. If a current version exists, archive it first
// (set archived_at=NOW()). The new row gets version = prev + 1, or 1 if none.
export async function saveNewUnderstanding({
  ticker,
  summaryMd,
  questionsAndAnswers,
  sources,
  last10kAccession,
  last10kPeriodEnd,
  model = "claude-sonnet-4-6",
}: {
  ticker: string;
  summaryMd: string;
  questionsAndAnswers: QnA[];
  sources: BusinessUnderstandingSource[];
  last10kAccession?: string | null;
  last10kPeriodEnd?: string | null;
  model?: string;
}): Promise<BusinessUnderstanding> {
  const canonical = await getCanonicalTicker(ticker);

  // Archive the current one (if any).
  await sql`
    UPDATE business_understanding
    SET archived_at = NOW()
    WHERE ticker = ${canonical} AND archived_at IS NULL
  `;

  const nextVersion = (await sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM business_understanding
    WHERE ticker = ${canonical}
  `) as unknown as { next_version: number }[];

  const rows = (await sql`
    INSERT INTO business_understanding
      (ticker, version, summary_md, questions_and_answers, sources,
       last_10k_accession, last_10k_period_end, generated_with_model)
    VALUES
      (${canonical}, ${nextVersion[0].next_version}, ${summaryMd},
       ${JSON.stringify(questionsAndAnswers)}::jsonb,
       ${JSON.stringify(sources)}::jsonb,
       ${last10kAccession ?? null},
       ${last10kPeriodEnd ?? null},
       ${model})
    RETURNING ticker, version, summary_md, questions_and_answers, sources,
              generated_at, generated_with_model, archived_at,
              last_10k_accession,
              TO_CHAR(last_10k_period_end, 'YYYY-MM-DD') AS last_10k_period_end
  `) as unknown as BusinessUnderstanding[];
  return rows[0];
}

// Stale when the tracked 10-K accession differs from the latest one known
// to the caller. Mirrors isRedFlagsStale in lib/redFlags.ts.
export function isBusinessUnderstandingStale(
  cached: BusinessUnderstanding,
  latest10kAccession: string | null,
): boolean {
  if (!latest10kAccession) return false;
  if (!cached.last_10k_accession) return true;
  return cached.last_10k_accession !== latest10kAccession;
}

// Append a user follow-up Q&A to a specific (usually current) version's chat
// history. Does not bump version — follow-ups accumulate inside the same spec.
export async function appendFollowupQA({
  ticker,
  version,
  qa,
}: {
  ticker: string;
  version: number;
  qa: Omit<QnA, "type">;
}): Promise<void> {
  const canonical = await getCanonicalTicker(ticker);
  const entry: QnA = {
    ...qa,
    type: "user_followup",
    created_at: qa.created_at ?? new Date().toISOString(),
  };
  await sql`
    UPDATE business_understanding
    SET questions_and_answers = questions_and_answers || ${JSON.stringify([entry])}::jsonb
    WHERE ticker = ${canonical} AND version = ${version}
  `;
}
