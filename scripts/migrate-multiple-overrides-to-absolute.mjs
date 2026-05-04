#!/usr/bin/env node

// Migrate implied-return multiple overrides from rate-based (multiple_change_*_override)
// to absolute terminal Nx (multiple_*_terminal_override). The new model preserves user
// intent ("the multiple I believe this business should converge to long-term") instead
// of freezing a compression rate that ignores subsequent price movement.
//
// Conversion: terminal_override = multiple_current × (1 + change_override)^10.
// Uses the multiple_current persisted on the row at migration time — i.e. whatever
// the row reflects right now after the most recent ensureValuation. For Joseda's
// MSFT case this maps to the value he sees in the UI today (24.5x), not what he
// originally typed (25x). One-edit fix: re-edit the multiple after deploy if the
// 0.5x drift matters.
//
// Idempotent: rows already migrated (terminal_override set, change_override null)
// are skipped. Safe to re-run.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const rows = await sql`
    SELECT id, position_id, assumptions
    FROM valuations
    WHERE method = 'implied_return'
  `;

  console.log(`Scanning ${rows.length} implied_return rows…`);

  let migrated = 0;
  let skipped = 0;
  let nullCurrent = 0;

  for (const row of rows) {
    const a = row.assumptions ?? {};

    const baseChange = a.multiple_change_base_override;
    const stressChange = a.multiple_change_stress_override;
    const baseTerminalAbs = a.multiple_base_terminal_override;
    const stressTerminalAbs = a.multiple_stress_terminal_override;

    const baseNeedsMigration =
      (baseChange !== null && baseChange !== undefined) &&
      (baseTerminalAbs === null || baseTerminalAbs === undefined);
    const stressNeedsMigration =
      (stressChange !== null && stressChange !== undefined) &&
      (stressTerminalAbs === null || stressTerminalAbs === undefined);

    if (!baseNeedsMigration && !stressNeedsMigration) {
      skipped++;
      continue;
    }

    const current = a.multiple_current;
    if (current === null || current === undefined || current <= 0) {
      console.warn(
        `[skip] row id=${row.id} position_id=${row.position_id}: multiple_current is null/zero — cannot derive absolute terminal. Clearing legacy override.`,
      );
      nullCurrent++;
      const cleaned = {
        ...a,
        multiple_change_base_override: null,
        multiple_change_stress_override: null,
      };
      await sql`
        UPDATE valuations
        SET assumptions = ${JSON.stringify(cleaned)}
        WHERE id = ${row.id}
      `;
      continue;
    }

    const next = { ...a };

    if (baseNeedsMigration) {
      const terminal = current * Math.pow(1 + baseChange, 10);
      next.multiple_base_terminal_override = terminal;
      next.multiple_change_base_override = null;
      console.log(
        `[migrate] row id=${row.id} position_id=${row.position_id} BASE: rate ${(baseChange * 100).toFixed(2)}%/y · current ${current.toFixed(2)}x → terminal ${terminal.toFixed(2)}x`,
      );
    }

    if (stressNeedsMigration) {
      const terminal = current * Math.pow(1 + stressChange, 10);
      next.multiple_stress_terminal_override = terminal;
      next.multiple_change_stress_override = null;
      console.log(
        `[migrate] row id=${row.id} position_id=${row.position_id} STRESS: rate ${(stressChange * 100).toFixed(2)}%/y · current ${current.toFixed(2)}x → terminal ${terminal.toFixed(2)}x`,
      );
    }

    await sql`
      UPDATE valuations
      SET assumptions = ${JSON.stringify(next)}
      WHERE id = ${row.id}
    `;
    migrated++;
  }

  console.log("");
  console.log(`Done. migrated=${migrated} skipped=${skipped} nullCurrent=${nullCurrent}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
