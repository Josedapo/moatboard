# Moatboard — On hold (since 2026-05-13)

This project is paused. The `on-hold-static` branch only serves a static landing page at `www.moatboard.com`.

## Reactivation

1. In Vercel → Settings → Git, change Production Branch back to `main`.
2. In Vercel → Settings → Environment Variables, restore the productive secrets (preserved locally in `.env.local`): `DATABASE_URL`, `DATABASE_URL_PROD`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, NextAuth Google OAuth credentials, etc.
3. In Neon, resume both Postgres instances (`ep-withered-frost-alt6q9b9` prod, `ep-mute-haze-al6g5n6q` dev). If they were deleted, restore from the dumps at `/Users/joseda/Claude/Moatboard/backups-on-hold-2026-05-13/`.
4. Verify crons reappear in Vercel UI from `vercel.json` on `main`.
5. Smoke test: `node scripts/smoke-claude-client.mjs` and a manual run of `/api/cron/signals`.

## State at pause

- Last production commit: see branch `production-archive`.
- Last working tree at pause (uncommitted edits to `CLAUDE.md`, `scripts/batch-triage-quality.ts`, `scripts/output/`) is preserved in `git stash` on this clone.
- Database dumps (1.0 GB prod + 2.3 GB dev) at `/Users/joseda/Claude/Moatboard/backups-on-hold-2026-05-13/`.
