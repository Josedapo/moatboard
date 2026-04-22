// Recent-filings panel data layer for /dashboard/discovery.
//
// Lists 13F filings whose filing_date falls within the last N days
// and that the requesting user has NOT yet dismissed from the panel.
// Joins against `discovery_funds` so the UI can render the fund
// name + tier + link to /dashboard/discovery/fund/{cik} directly.

import { sql } from "@/lib/db";

export type RecentFilingRow = {
  filing_id: number;
  fund_id: number;
  fund_cik: string;
  fund_display_name: string;
  fund_tier: "A" | "B" | "C" | "D" | "E";
  accession: string;
  period_of_report: string; // YYYY-MM-DD
  filing_date: string; // YYYY-MM-DD
  holdings_count: number;
};

// Ventana por defecto 14 días: tolera que el usuario no entre al
// dashboard durante una semana y aun así vea los filings que el cron
// detectó el lunes anterior. Si el user marca "visto", desaparece
// hasta que un filing futuro de ese fondo vuelva a entrar en ventana.
export async function listRecentFilingsForUser({
  userId,
  sinceDays = 14,
}: {
  userId: string | number;
  sinceDays?: number;
}): Promise<RecentFilingRow[]> {
  const rows = (await sql`
    SELECT
      df.id AS filing_id,
      f.id AS fund_id,
      f.cik AS fund_cik,
      f.display_name AS fund_display_name,
      f.tier AS fund_tier,
      df.accession,
      TO_CHAR(df.period_of_report, 'YYYY-MM-DD') AS period_of_report,
      TO_CHAR(df.filing_date, 'YYYY-MM-DD') AS filing_date,
      df.holdings_count
    FROM discovery_filings df
    JOIN discovery_funds f ON f.id = df.fund_id
    LEFT JOIN discovery_filing_dismissals dfd
      ON dfd.filing_id = df.id AND dfd.user_id = ${userId}
    WHERE df.filing_date >= NOW() - (${sinceDays} || ' days')::INTERVAL
      AND f.active = TRUE
      AND dfd.id IS NULL
    ORDER BY df.filing_date DESC, f.tier ASC, f.display_name ASC
  `) as unknown as RecentFilingRow[];
  return rows;
}

// Idempotent marcado "visto". Si el user ya había dismissado el
// filing, no-op silencioso. Si no existía, inserta con dismissed_at=
// NOW(). El cron nunca escribe aquí — solo el server action del UI.
export async function dismissFiling({
  userId,
  filingId,
}: {
  userId: string | number;
  filingId: number;
}): Promise<void> {
  await sql`
    INSERT INTO discovery_filing_dismissals (user_id, filing_id)
    VALUES (${userId}, ${filingId})
    ON CONFLICT (user_id, filing_id) DO NOTHING
  `;
}
