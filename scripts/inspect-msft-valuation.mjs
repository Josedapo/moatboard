#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const rows = await sql`
    SELECT v.id as val_id, v.position_id, v.method, v.generated_at,
           p.ticker, p.id as pos_id, p.user_id,
           v.assumptions
    FROM valuations v
    JOIN positions p ON p.id = v.position_id
    WHERE p.ticker = 'MSFT' AND v.method = 'implied_return'
  `;
  console.log(`Found ${rows.length} MSFT implied_return valuations\n`);
  for (const r of rows) {
    const a = r.assumptions ?? {};
    console.log(`--- val_id=${r.val_id} position_id=${r.pos_id} user=${r.user_id} generated=${r.generated_at}`);
    console.log("multiple_label:", a.multiple_label);
    console.log("multiple_current:", a.multiple_current);
    console.log("multiple_median:", a.multiple_median);
    console.log("multiple_q1:", a.multiple_q1);
    console.log("multiple_base_terminal:", a.multiple_base_terminal);
    console.log("multiple_stress_terminal:", a.multiple_stress_terminal);
    console.log("multiple_base_terminal_override:", a.multiple_base_terminal_override);
    console.log("multiple_stress_terminal_override:", a.multiple_stress_terminal_override);
    console.log("multiple_change_base_override (legacy):", a.multiple_change_base_override);
    console.log("multiple_change_stress_override (legacy):", a.multiple_change_stress_override);
    console.log("multiple_change_base:", a.multiple_change_base);
    console.log("multiple_change_stress:", a.multiple_change_stress);
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
