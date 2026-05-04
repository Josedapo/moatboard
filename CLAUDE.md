# Moatboard App - Development Instructions

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript + Turbopack
- **CSS:** Tailwind CSS v4 (custom navy palette in `globals.css`)
- **Hosting:** Vercel (auto-deploy from GitHub `Josedapo/moatboard` on push to `main`)
- **Database:** Vercel Postgres (Neon) via `@neondatabase/serverless`
- **Auth:** NextAuth.js v5 (Auth.js beta) — Google OAuth only (magic link not configured)
- **AI:** Dual-mode caller in `src/lib/claudeClient.ts`. `MOATBOARD_AI_MODE=local` (Joseda's laptop) spawns the Claude Code CLI with `ANTHROPIC_API_KEY` stripped so it routes through the Max subscription (Opus 4.7 by default, no API spend). `MOATBOARD_AI_MODE=remote` (default · production on Vercel) uses `@anthropic-ai/sdk` + Sonnet 4.6. Two helpers: `callText` for prose and `callJson` for structured output. In remote mode `callJson` uses Anthropic's `tool_use` for guaranteed valid JSON; in local mode the schema is injected into the prompt and Opus's text output is parsed — Opus 4.7 is reliable enough at format adherence that the two typed callers (`businessUnderstandingAi`, `redFlagsAi`) ride that path without regressing the quote-escaping bug we originally solved with tool_use.
- **Financial data:** `yahoo-finance2` v3 (instantiated as `new YahooFinance({ suppressNotices: ["yahooSurvey"] })`)
- **Analytics:** GA4 (planned, not yet wired)

## Project Structure

```
src/
├── app/
│   ├── page.tsx                       # Public homepage
│   ├── about/page.tsx                 # Methodology — 8 sections (philosophy, investors, dimensions, tiers, what's NOT scored, coverage, further reading)
│   ├── pricing/page.tsx               # Free vs Pro
│   ├── auth/signin/page.tsx           # Google sign-in
│   ├── api/auth/[...nextauth]/route.ts # NextAuth handlers (runtime: nodejs)
│   └── dashboard/
│       ├── page.tsx                   # Portfolio list (filters by net shares > 0; "Próximas presentaciones" block; per-ticker new-signal badge; "Añadir acción" inline ticker input → /comprar). Post-2026-04-29: search/open business surface removed from here — unified into Discovery as the single entry surface for any ticker.
│       ├── actions.ts                 # openTickerAction (search/open → /ticker/[upper], used by Discovery's entry box), startAnalysisAction (creates draft + session, redirects to /analyze/[ticker], used from the ficha's "Empezar análisis" / "Re-analizar" CTA), reanalyzeTickerAction (thin alias of startAnalysisAction for callers that submit plain FormData), deletePositionAction, markSignalReviewedAction, reopenSignalAction, summarizeSignalAction
│       ├── inbox/page.tsx             # Pending signals (status=new only), grouped by ticker, heartbeat line, nav badge count
│       ├── watchlist/page.tsx         # Tickers tagged with the star. Each row links to /dashboard/ticker/[ticker]
│       ├── watchlist/[ticker]/page.tsx # Legacy alias — 308 redirect to /dashboard/ticker/[symbol] (the unified ficha)
│       ├── comprar/[ticker]/page.tsx  # Buy form (price + shares + date + pre_commitment_md required on first buy / optional operation_note on adds + opt-in star). recordBuyTransactionAction promotes draft, snapshots, redirects to /position/[id]
│       ├── learn/valuation/page.tsx   # Pedagogical page (Spanish, 7 sections) explaining the implied-return frame: question, 3 components, growth anchors, decision rule, tier thresholds, why not DCF, edge cases. Linked from ImpliedReturnCalculator.
│       ├── discovery/
│       │   ├── page.tsx               # Discovery leaderboard — consensus conviction across 42 curated funds, sortable columns, filters all/unseen/watchlist, ★ inline with ticker, "Análisis" column (Analizada / No analizada by business_tier_source), entrantes-nuevos panel, ticker search
│       │   ├── funds/page.tsx         # Fund roster index grouped by tier, sortable (portfolio value, holdings, top-5 concentration, movements Q, último 13F)
│       │   └── fund/[cik]/page.tsx    # Per-fund detail — header + movements summary (new/add/trim/exit) + holdings table with per-row movement badge + "Solo analizables" toggle
│       ├── api/cron/signals/route.ts  # Vercel Cron endpoint (0 7 * * * UTC, CRON_SECRET-protected) — invokes runDailySignalsJob + expireOldSignals
│       ├── analyze/[ticker]/
│       │   ├── page.tsx               # Wizard dispatch — 4 linear steps (quality → understanding → red_flags → valuation). Closing the wizard returns to Discovery; the session row stays resumable forever
│       │   └── actions.ts             # advanceStepAction (hooks upsertPreAnalysisFromExisting on every step boundary), navigateToStepAction, exitAnalysisAction, restartAnalysisAction (deletes session row — cached pieces survive)
│       └── position/[id]/
│           ├── page.tsx               # Tabbed position detail (Overview / Negocio / Calidad / Valoración / Presentaciones) + chrome (header w/ 52w mini-bar, Decision context strip, "Ver evolución" outline button). Overview includes NextEarningsCard on top.
│           ├── actions.ts             # thesis actions, updatePositionPreCommitmentAction, addOperationAction, updateValuationAssumptionsAction, updateImpliedReturnOverrideAction (regenerate actions removed — Iris owns refresh)
│           └── trajectory/            # URL stays /trajectory for bookmark stability; user-facing label is "Evolución"
│               ├── page.tsx           # Full Evolución view — builds synthetic "hoy" pseudo-snapshot (id=-1), loads preloaded moat validations, renders TrajectoryExplorer
│               └── actions.ts         # revalidateMoatAction — writes to moat_validations table, does NOT touch moat_assessments cache
├── components/                        # All UI components (mix of Server + Client)
│   ├── AnalyzeEntryForm.tsx           # Search/open business entry (lives in Discovery aside, post-2026-04-29 cleanup). Validates the ticker via openTickerAction and redirects to /dashboard/ticker/[upper] — the unified ficha is the single canonical surface, the wizard is reachable only from there.
│   ├── DashboardNav.tsx               # Server nav frame; reads `new` signal count via sql query and passes to DashboardNavLinks for the Inbox badge.
│   ├── DashboardNavLinks.tsx          # Client links (Portfolio · Watchlist · History · Inbox) with active state + amber count badge on Inbox
│   ├── SignalsInbox.tsx               # Server. Inbox list component shared by /dashboard/inbox; groups signals by ticker + heartbeat line consuming `cron_runs`.
│   ├── SignalCard.tsx                 # Client. Per-signal card with severity frame (emerald floor / amber material / navy informational), EDGAR + Evolución links, AI summary (collapsible), actions. `mode` prop: `new` shows "Marcar revisada"; `reviewed` desaturates + ✓ + "Reabrir".
│   ├── UpcomingEarnings.tsx           # Server. Dashboard "Próximas presentaciones" — one row per portfolio + watchlist ticker with known earningsDate. Information, not alert.
│   ├── MoatboardAnalysis.tsx          # Scorecard UI (read-only — no regenerate button, refresh driven by Iris)
│   ├── ImpliedReturnCalculator.tsx    # Primary widget of the Valuation section after 2026-04-25 redesign. Three visual zones top→bottom: ZONE 1 Conclusión (verdict card with checks), ZONE 2 Cálculo (3-col table Componente · Base · Estrés + threshold + floor), ZONE 3 Detalles (collapsed: anchors, formulas, tier rationale). Renders target buy price when verdict is negative.
│   ├── Valuation.tsx                  # Valuation section dispatcher: routes to ImpliedReturnView when method='implied_return' (post-2026-04-25 default); falls back to legacy 4-tool ValuationToolkit for older rows. Cross-check (DCF/AFFO/Excess Returns/AI multiples) lives collapsed under "Otros métodos · contexto histórico + cross-check".
│   ├── Thesis.tsx                     # AI/user thesis UI (still in repo; not currently rendered on the position page after the 2026-04-20 redesign)
│   ├── BusinessDescription.tsx        # Stateless paragraph splitter for Yahoo summary (legacy — no longer rendered on position page after 2026-04-21)
│   ├── DiscoveryLeaderboard.tsx       # Client. Sortable table, filter chips, ticker search, expandable rows with tier-grouped fund list (fund names link to /fund/[cik])
│   ├── DiscoveryNewEntrants.tsx       # Client. Collapsible "Entrantes nuevos en ≥5 fondos este Q" panel
│   ├── DiscoveryFundsList.tsx         # Client. Tier-grouped, sortable roster index table
│   ├── FundHoldingsTable.tsx          # Client. Per-fund holdings with movement badge column (NEW / ▲ % / = / ▼ %) + "Solo analizables" toggle
│   ├── FundMovementsSummary.tsx       # Client. 4 headline cards (nuevas/aumentos/recortes/salidas) + collapsible per-category lists
│   ├── analysis/                      # Wizard-specific components
│   │   ├── WizardShell.tsx            # Step indicator (5 steps; past steps clickable via furthest_step tracking) + exit/restart
│   │   ├── StepUnderstanding.tsx      # Wraps shared/BusinessUnderstandingView; checkpoint (Sí entiendo / Con dudas / No lo entiendo)
│   │   ├── StepRedFlags.tsx           # Wraps shared/RedFlagsList; "Continuar al análisis de calidad" + "Saltar a la decisión"
│   │   ├── BusinessTypeHeader.tsx     # Compact pill + chips renderered at the top of StepQuality (no longer its own step)
│   │   ├── StepQuality.tsx            # Renders BusinessTypeHeader + MoatboardAnalysis; "Continue to valuation" + "Skip to decision"; gates <5 dims
│   │   └── StepValuation.tsx          # Reuses ValuationSection with the guide. Footer carries the "Comprar acciones de TICKER" CTA (link to /dashboard/comprar/[ticker]) + "Cerrar análisis"
│   ├── position/                      # Position-page-specific components
│   │   ├── PositionTabs.tsx           # Client tab shell (Overview / Calidad / Negocio / Valoración / Decisión / Señales) — useState, panels rendered server-side, optional `badges` prop for per-tab numeric counts (used on Señales for pending signals)
│   │   ├── DecisionPanel.tsx          # Server. Decisión tab — three actions: Comprar (link to /comprar), toggle watchlist (★), Re-analizar / Empezar análisis. Two orthogonal flags drive the surface: isOwned + isOnWatchlist (post-2026-04-28 watchlist refactor)
│   │   ├── NextEarningsCard.tsx       # Anticipation-only banner with next earnings date + relative day count. Accepts optional reportType ("10-K" | "10-Q") which renders as a pill when inferable.
│   │   ├── PresentationsPanel.tsx     # Server. NextEarningsCard + vertical list of all signals for the ticker (new + reviewed), with pending/reviewed counts.
│   │   ├── PositionPreCommitment.tsx  # Client. Compromiso de salida block with inline edit; navy left-border accent + blockquote body
│   │   ├── PositionSummary.tsx        # KPI strip: Shares · Avg cost · Invested · Now · Unrealized (only P&L is colored)
│   │   ├── AddOperationForm.tsx       # Client. Inline expand form for Add/Sell on live positions; calls addOperationAction
│   │   ├── DecisionContextStrip.tsx   # Server. Conditional banner (re-bought after discard / invested with doubts / understanding regenerated since buy)
│   │   ├── TrajectoryExplorer.tsx     # Client. Full /trajectory surface — vertical selector (HOY + COMPRA + intermediates), Compromiso card, Calidad (TierInline + MoatValidationPanel + DimensionComparison), Valoración (RangeBar per primary/secondary tool)
│   │   ├── MoatValidationPanel.tsx    # Client. Runs comparative moat validation via IA, hydrates from preloaded moat_validations, 4 verdict states (intact/expanding/compressing/dissolved)
│   │   └── FiftyTwoWeekBar.tsx        # Compact 52w min/max bar with current marker — replaces the text line in the header
│   └── shared/                        # Pure presentational components reused across wizard + position page
│       ├── BusinessUnderstandingView.tsx  # Spanish 5-section summary + pre-Q&A accordions + user follow-ups
│       ├── RedFlagsList.tsx               # Severity-grouped flag cards + summarizeFlagsBySeverity helper
│       └── TransactionOperationNotesList.tsx  # Operation log: type + date + shares @ price + per-tx note (the column was historically pre_commitment_md; semantics now = operation note)
├── lib/                               # Domain logic, DB, AI, pure functions
│   ├── db.ts                          # Neon serverless client
│   ├── schema.sql                     # Source of truth for DB schema
│   ├── financial.ts                   # yahoo-finance2 wrapper; fetchMultiYearFundamentals merges SEC with yfinance for sharesDiluted when SEC leaves it all-null. Foreign filers (TSM/TM/ASML/BABA/NVO…) detected via financialCurrency mismatch and FX-converted to USD before downstream consumption (post-2026-04-30) — without it the implied-return math divided local-currency FCF by USD market cap and produced phantom yields (TSM 35% on $2T mcap)
│   ├── fx.ts                          # FX rates via yfinance XXXUSD=X. getFxToUsd(currency) with 6h in-memory cache + USD short-circuit; applyFx(value, fxToUsd) helper for null-safe field conversion
│   ├── scorecard.ts                   # Per-metric quality scoring (pure) + business-type helpers (isBalanceSheetBusiness, isRealEstate, isCommodityCyclical) + multi-year scorers (median + worst-year)
│   ├── verdict.ts                     # Formulaic tier computation + reason templates (pure)
│   ├── moats.ts                       # CRUD for moat_assessments
│   ├── moatAi.ts                      # AI moat assessment (Spanish reasoning)
│   ├── moatValidations.ts             # CRUD for moat_validations (per-snapshot history written from /trajectory)
│   ├── moatValidationAi.ts            # AI comparative moat validation (intact/expanding/compressing/dissolved verdict)
│   ├── snapshotDiff.ts                # Pure types + diffSnapshots() — extracted from snapshots.ts so Client Components can import without bundling the Neon driver
│   ├── reviewSignals.ts               # CRUD for review_signals — createIfMissing (idempotent by accession), listSignalsForUser, listSignalsForTicker (new+reviewed filter), countNewSignalsByTicker, markSignalReviewed, reopenSignal, saveSignalSummary, getStalestUnreviewedFloorSignal, inferNextReportType (10-K vs 10-Q heuristic from filing history), expireOldSignals
│   ├── signalClassifier.ts            # Pure deterministic mapping: SEC form + 8-K Item codes → event_type + severity. 10-Q/10-K → floor. Listed 8-K Items (1.01…8.01) → material/informational. 2.02/5.07/9.01 silenced.
│   ├── secFilings.ts                  # Fetches /submissions/CIK{cik}.json, zips parallel arrays into RawFiling[], filters to relevant forms + 180d window
│   ├── signalFlow.ts                  # Orchestrator: ensureSignalsForTicker + listActiveTickersForUser + runDailySignalsJob (writes cron_runs heartbeat row per run)
│   ├── cronRuns.ts                    # CRUD for cron_runs heartbeat (getLatestCronRun)
│   ├── signalLabels.ts                # EVENT_TYPE_LABEL (Spanish) + SOURCE_LABEL + SEVERITY_SPEC (tier chip classes)
│   ├── signalSummaryAi.ts             # On-demand AI summary per signal — fetches EDGAR document, strips HTML, calls Claude Sonnet 4.6 with plain-language Spanish prompt, caches on review_signals.summary_md
│   ├── verdictAi.ts                   # AI prose composition for verdict_reason (Spanish)
│   ├── analysis.ts                    # Orchestrator: runAnalysis() ties scorecard + moat + tier + prose
│   ├── moatboardAnalyses.ts           # CRUD for moatboard_analyses
│   ├── valuation.ts                   # Pure DCF (two-stage owner earnings) + tier types — used by the legacy cross-check, not by the primary verdict
│   ├── impliedReturn.ts               # Pure CAGR formula (FCF Yield + Growth + Δ Multiple), two-step decision rule (atractivo + no-desastre), TIER_THRESHOLDS (12/14/17%), floor (Treasury+2%), computeTargetBuyPrice (inverts on FCF Yield to get the price at which both checks pass). Primary verdict logic since 2026-04-25.
│   ├── sustainableGrowth.ts           # Pure 2-anchor growth: Historical (revenue CAGR for product/balance-sheet, AFFO/share for REITs) + Fundamental (ROIC × retention for product, ROE × retention for banks, ROA × retention for REITs). Takes the lesser, caps at 20%, stress = base × 0.7. Anchors computed on capMultiYearForScoring(10y) so the growth driving the implied-return verdict matches the scorecard's revenue-growth dimension on the same page.
│   ├── valuationAi.ts                 # AI multiples fallback (Spanish reasoning)
│   ├── valuations.ts                  # CRUD for valuations; RelativeValuationSnapshot type
│   ├── relativeValuation.ts           # Pure distribution stats (median/Q1/Q3/IQR) and classifier
│   ├── valuationGuideAi.ts            # AI valuation guide (Spanish reasoning)
│   ├── valuationGuides.ts             # CRUD for valuation_guides (per-ticker cache, TTL 365d)
│   ├── positionFlow.ts                # ensureAnalysis / ensureValuation / computeRelativeValuationContext
│   ├── snapshotFlow.ts                # createTransactionalSnapshot + ensureQuarterlySnapshots orchestrators
│   ├── tooHard.ts                     # Sector/industry too-hard gate (Buffett circle-of-competence)
│   ├── thesis.ts                      # AI thesis generation (6 structured fields, Spanish, gated by tier; not auto-invoked — manual generate from position page)
│   ├── theses.ts                      # CRUD for theses (user vs ai source)
│   ├── positions.ts                   # CRUD for positions; getCostBasis derives from transactions
│   ├── positionTransactions.ts        # Log of buy/add/trim/sell + getCostBasis aggregate
│   ├── businessUnderstanding.ts       # CRUD for business_understanding (versioned per ticker)
│   ├── businessUnderstandingAi.ts     # Spanish AI generator + follow-up Q&A
│   ├── redFlags.ts                    # CRUD for qualitative_red_flags
│   ├── redFlagsAi.ts                  # Spanish AI generator for red flags by category + severity
│   ├── watchlistEntries.ts            # CRUD for watchlist_entries — pure tag (no fields). isOnWatchlist / listWatchlist / addToWatchlist / removeFromWatchlist + listWatchlistEnriched (joins tier + flag counts + implied-return verdict)
│   ├── analysisSessions.ts            # CRUD for analysis_sessions (current_step + furthest_step + outcome)
│   ├── snapshots.ts                   # CRUD for fundamentals_snapshots + diffSnapshots
│   ├── sec.ts                         # SEC EDGAR integration; persists latestFiling (accession/period/form/filed) for quarterly snapshot triggering
│   ├── secParser.ts                   # XBRL parser; extractLatestFiling walks raw_facts to find most recent 10-Q/10-K (walks ALL anchor tags — critical after ASC 606 migration). Post-2026-04-27: aggregateAnnualFromQuarterly suma 4 trimestres encadenados a anual (opt-in para cogs/grossProfit, anchored a fiscal year ends de revenue) — recupera INTU 2018-2020 grossProfit que solo se reportaba quarterly. yearsAvailable filter ya no requiere sharesDiluted — Visa-class filers (V, MA) que no reportan share count en XBRL pasan el gate, yfinance merge llena shares.
│   ├── secDocument.ts                 # Shared EDGAR primary-document helpers: fetchFilingText, stripHtml, extractItem1A. Used by signalSummaryAi + filingForPrompt
│   ├── filingForPrompt.ts             # Orchestrators prepareUnderstandingFiling (start-truncated 10-K) + prepareRedFlagsFiling (tries Item 1A extraction, falls back to end-truncated)
│   ├── thirteenF.ts                   # Discovery: 13F-HR XML parser. fetchRecentThirteenFFilings, parseInformationTable. Per-filing value-unit detection (thousands vs whole-dollar)
│   ├── cusip.ts                       # Discovery: CUSIP→ticker resolver via OpenFIGI /v3/mapping (25 req/min free tier, 2.6s throttle). HTTP errors throw (no spurious null cache)
│   ├── discoveryFlow.ts               # Discovery: ingestRecentFilings(fundId, n) — fetches + parses + persists the N most recent 13F per fund. Idempotent by (fund_id, accession)
│   ├── discoveryLeaderboard.ts        # Discovery: computeLeaderboard — per-ticker aggregate across latest filing per fund, conviction = Σ tier_weight × weight_in_fund
│   ├── discoveryDelta.ts              # Discovery: QoQ deltas + new entrants (≥5 funds, not in prior quarter)
│   ├── discoveryFund.ts               # Discovery: per-fund detail (meta + latest filing + holdings rolled up by CUSIP) + computeFundMovements (new/add/trim/exit, weight-delta classifier with 2pp absolute threshold + share/weight sign guards)
│   └── discoveryFundList.ts           # Discovery: listFundsWithStats — roster index with portfolio value, top-5 concentration, movements count
├── proxy.ts                           # Auth gating (Next.js 16 — was middleware.ts)
├── auth.ts                            # NextAuth config (Neon adapter)
└── types/next-auth.d.ts               # session.user.id augmentation
```

## Database Schema

Schema source of truth: `src/lib/schema.sql`. Apply via:

```bash
node scripts/init-db.mjs
```

The script DROPs legacy tables (`theses`, `moatboard_analyses` when their CHECK constraints change) before recreating, so it's safe to re-run after schema edits. Drop list is at the top of the script — add new entries when CHECK constraints change.

**Local DB === Production DB.** `DATABASE_URL` in `.env.local` points to the same Neon Postgres instance Vercel production reads. Implications:
- Any migration or maintenance script Joseda runs locally (`node scripts/add-*.mjs`, `node scripts/extend-*.mjs`, `node scripts/seed-*.mjs`, `scripts/canonicalize-*.mjs`, etc.) writes to production immediately. There is **no separate prod-migration step** after a local apply.
- After deploying code that depends on a new table or CHECK constraint, Claude must verify the migration already ran (or run it) — but does **not** need to ask Joseda to re-run scripts that were already applied during local dogfooding.
- Any data-mutating script (`wipe-user-data.mjs`, seeds, ad-hoc `UPDATE`s) affects real production rows. Treat every DB write as a production write.
- Read scripts (e.g. inspecting current state with `SELECT`) are safe and should be the default verification step before re-running a migration.

Tables:
- `users`, `accounts`, `sessions`, `verification_token` — NextAuth (Neon adapter)
- `positions` — user portfolio entries (`user_id`, `ticker`, `pre_commitment_md`, `pre_commitment_edited_at`, `created_at`). `pre_commitment_md` is the position-level "compromiso de salida" — what would make Joseda lose confidence in this investment. Required on first buy via /dashboard/comprar (the post-2026-04-28 model elevates this from optional to mandatory at the transactional surface); editable later from the position page. Cost basis lives in `position_transactions`. Dashboard filters by **net shares > 0** (sum of buys+adds − trims−sells) so closed positions and drafts both disappear from Portfolio automatically. Draft positions are the anchor for cached `moatboard_analyses` / `valuations` / `moat` rows — they persist indefinitely (deleting them would cascade the quality tier away and break Discovery's at-a-glance tier+flag chips). Only promoted-to-live positions gain `position_transactions` rows.
- `position_transactions` — log of `buy`/`add`/`trim`/`sell` per position (Trim retired from UI 2026-04-20; CHECK still allows it for legacy rows). Each row has `transaction_date`, `price`, `shares`, and optional `pre_commitment_md`. **Semantics shifted 2026-04-20:** the column is now the **operation note** ("why this op"), not a per-transaction pre-commitment. Column name kept for back-compat. Cost basis derived (`getCostBasis`).
- `fundamentals_snapshots` — immutable frozen frames, per-user per-ticker. `trigger` ∈ `transaction` / `quarterly_10q` / `annual_10k`. Stores tier, scorecard_summary, multi_year, moat JSONB, valuation method + IVs + assumptions + guide, business_understanding_version, thesis_snapshot, current_price, sec_filing_accession. Partial unique index on `(user_id, ticker, sec_filing_accession) WHERE sec_filing_accession IS NOT NULL` prevents duplicating a filing's snapshot.
- `business_understanding` — AI-generated plain-language summary per ticker, versioned. PK `(ticker, version)`. Regeneration archives the previous row (`archived_at`). Stores `summary_md` (JSON-serialized section list), `questions_and_answers` (pregenerated + user follow-ups), `sources`.
- `qualitative_red_flags` — per-ticker AI-extracted red flags (`flags` JSONB by category + severity). Tracks `last_10k_accession` for invalidation.
- `watchlist_entries` — per-user watchlist tags. Pure on/off — no `reason_md` / `status` / `review_when` (collapsed in the post-2026-04-28 refactor). UNIQUE (user_id, ticker). Migrated from the previous `ticker_states` table via `scripts/migrate-watchlist-tags.mjs`; the previous concepts `in_portfolio` (now derived from `positions` with net>0) and `discarded` (eliminated as a concept — closing the wizard without buying is the new "discard") collapsed away.
- `analysis_sessions` — wizard state per `(user_id, ticker)`. `current_step` ∈ `understanding`/`red_flags`/`quality`/`valuation`/`decision`/`completed` (5 active steps; `business_type` was removed 2026-04-20 when it consolidated into `quality`). `furthest_step` drives backward navigation. `outcome` + `completed_at` on terminal decisions. Partial unique index enforces one active session per ticker.
- `moat_assessments` — **per-ticker, shared across users**, AI-evaluated, TTL 365 days. Reasoning now in Spanish. **Never written from the trajectory view** — that path uses `moat_validations` to avoid invisible side-effects on the main ficha + other users + future snapshots.
- `moat_validations` — **per-user, per-snapshot** comparative moat validations (the output of the trajectory "Validar con IA" button). Each row is immutable; multiple validations against the same `from_snapshot_id` are allowed so the table doubles as a revalidation history. Carries the verdict (`intact` / `expanding` / `compressing` / `dissolved`), the original moat at the moment of validation, and the fresh moat read. Created 2026-04-20 via additive migration `scripts/add-moat-validations-table.mjs`.
- `valuation_guides` — **per-ticker, shared across users**, AI-generated advice on which valuation tools matter most (primary/secondary/cautious + reasoning). Reasoning in Spanish. TTL 365 days.
- `moatboard_analyses` — per-position verdict (tier, verdict_reason, scorecard_summary, moat snapshot). Verdict prose now in Spanish.
- `valuations` — per-position valuation row. `method` CHECK constraint allows `'implied_return' | 'dcf' | 'affo_dcf' | 'excess_returns' | 'ai_multiples'` (extended 2026-04-25 via `scripts/extend-valuations-method-check.mjs`). **Primary method is `implied_return`** (the assumptions JSONB carries fcf_yield, growth anchors, multiple_change_base/stress, threshold, floor, base_cagr, stress_cagr, verdict, verdict_reason, plus the legacy absolute-method computation under `assumptions.cross_check` so users can see DCF/AFFO/Excess Returns as collapsed cross-check). Legacy rows with `method='dcf'/'affo_dcf'/'excess_returns'/'ai_multiples'` keep rendering through the old toolkit. The compound `tier`, `dcf_tier`, `relative_tier` columns and `intrinsic_value*` numeric fields persist for back-compat (populated from cross-check when method='implied_return'); the UI of implied_return reads everything from the assumptions JSONB.
- `theses` — per-position user thesis (source: 'user' | 'ai', raw_text, structured_content JSONB, `pre_commitment_md`). AI generation is in Spanish; not auto-invoked from the wizard today (decision deferred — see Pending Decisions).
- `sec_fundamentals_cache` — raw XBRL + parsed_annual + `latest_quarter_{accession,period_end,form,filed}` for quarterly snapshot triggering. `parsed_quarterly` column exists but not yet populated.
- `review_signals` — **per-user SEC signal inbox** (Phase 6). One row per (user, ticker, accession). Lifecycle `new` → `reviewed` from UI (legacy `dismissed`/`expired` kept in CHECK for forward compat, not written from UI). Carries source (sec_8k/sec_10q/sec_10k/sec_10qa/sec_10ka), event_type + severity (floor/material/informational), source_url (EDGAR), raw_payload (form + items), summary_md + summarized_at + summarized_with_model (AI plain-language summary, lazy-filled on demand). Populated by the daily Vercel Cron.
- `moat_validations` — **per-user, per-snapshot** comparative moat validations (output of the trajectory "Validar con IA" button). Immutable rows; revalidation history.
- `cron_runs` — heartbeat log for every cron run (started_at, finished_at, ok, processed_tickers, inserted_signals, error_count, error_summary). Consumed by SignalsInbox for "última verificación hace Xh".
- `monthly_reviews` — placeholder, kept for possible future ceremonial anual review (Phase 6 pending).
- `discovery_funds` — **roster of 42 active curated world-class funds** (43 total — Pabrai inactive since 2012) seeded via `scripts/seed-discovery-funds.mjs`. Columns: cik, manager_name, display_name, tier ('A'|'B'|'C'|'D'|'E'), tier_weight (3.0/2.0/1.5/1.0/0.5 — 1.5 used to penalize Druckenmiller's higher quarterly turnover), philosophy, active. Pabrai's CIK 0001173334 marked `active=false` (last 13F-HR 2012 — stale filer entity).
- `discovery_filings` — one row per parsed 13F-HR per fund, UNIQUE(fund_id, accession). Tracks period_of_report, filing_date, total_value_usd, holdings_count, source_url.
- `discovery_holdings` — per-position rows from a 13F info table. Roll-up by CUSIP when filer reports shared vs sole voting authority separately. `ticker` nullable (ADRs without US listing, OTC, delisted). `weight_in_fund` precomputed so reads don't re-derive.
- `discovery_cusip_ticker` — CUSIP→ticker cache populated via OpenFIGI. HTTP errors do NOT cache null; only legitimate "no match" responses get persisted as ticker=null. Script `scripts/reresolve-cusips.ts` exists to wipe null rows and re-query after rate-limit incidents.

## Architectural Patterns

### "Ensure" pattern (auto-run on first render)

`src/lib/positionFlow.ts` exposes `ensureAnalysis()` and `ensureValuation()`. The position detail page calls them in `Promise.all`. If the row exists in DB → return it (instant). If not → compute it via the orchestrator + save → return it. This eliminates "Run" buttons; data appears automatically.

### Quality verdict pipeline (formulaic + minimal AI)

```
fundamentals (yfinance, free/fast) + sector/industry from Quote
  → scorecard.ts: scoreMetric() per dimension; business-type routing
      · product businesses → 7 dimensions (ROIC, gross margin, FCF margin, op margin, share count, D/E, revenue growth)
      · balance-sheet businesses (banks / insurers / health insurers / mortgage REITs)
        → 6 dimensions (op margin, share count, revenue growth, ROE multi-year, ROA multi-year, BV/share 5y CAGR)
      · equity REITs → 7 dimensions (FCF margin, op margin, share count, revenue growth, AFFO payout, Net Debt/EBITDA, AFFO/share 5y CAGR)
      · dimensions that don't apply return `neutral` (hidden in UI, not counted in proportional tier)
  → moats.ts: cached moat for ticker
    └─ if missing/stale → moatAi.ts: assessMoat() → save + return
  → verdict.ts: computeQualityTier() (pure, deterministic, proportional on applicable dims)
      · too-hard sector modifier downgrades one level
      · moat archetype "none" hard-caps at Mediocre
  → verdictAi.ts: composeVerdictNarrative() (one short Claude call for prose)
    └─ on failure → verdict.ts: renderVerdictReason() (deterministic fallback)
  → save to moatboard_analyses
```

The tier itself is **never** AI-driven — only the prose. Reason: reproducibility, cost, and the philosophical principle that the verdict is a measurable judgment.

The position detail page wraps this in an **"unsupported business" gate** (`isOutsideFramework` in `src/app/dashboard/position/[id]/page.tsx`): when the scorecard has fewer than 5 applicable dimensions, OR when valuation falls to `ai_multiples` with op-margin worst-year below −50%, the page replaces Business Analysis / Valuation / Thesis with a single explanatory notice linking to `/about#coverage`.

### Valuation pipeline (post-2026-04-25 redesign)

The primary method is **implied_return**. Frame: "what return can I expect at this price?" instead of "is this below intrinsic?". The frame Buffett post-1985, Smith and Akre use operationally. The legacy absolute-valuation methods (DCF/AFFO/Excess Returns/AI multiples) still run in parallel and persist as `assumptions.cross_check` so users can see the deep-value lens, but never drive the verdict.

```
quote + fundamentals + multi-year + treasury + relative-history (parallel)
  → positionFlow.ts: computeAndSaveValuation
      · resolves quality tier (caller-provided or read from moatboard_analyses; fallback 'good')
      · runs computeLegacyValuation in parallel (DCF/AFFO/Excess Returns/AI multiples per business-type dispatch — same logic as before, now returns shape without saving)
      · sustainableGrowth.ts: computeSustainableGrowth({ multiYear, fundamentals, sector, industry })
          → cappedMultiYear = capMultiYearForScoring(multiYear)  // 10y window, matches scorecard
          → anchor 1: historical CAGR (revenue CAGR for product/balance-sheet, AFFO/share for REITs)
          → anchor 2: fundamental sostenible (ROIC × retention for product, ROE × retention for banks, ROA × retention for REITs)
          → base = min(anchors), capped at GROWTH_CAP (20%); stress = base × 0.7; optimistic = max(anchors), capped
      · FCF yield = (fundamentals.freeCashflow ?? recent SEC FCF) / quote.marketCap
      · ensureValuationGuide(ticker, …, availability) — runs HERE so primary_tool is known before implied return derives the multiple
      · multipleSelection.ts: selectPrimaryMultipleSnapshot({ guide, relative, sector, industry })
          → AI guide primary_tool (pe/pfcf/pb) → matching snapshot
          → fallback (no guide / dcf / cash_yield): balance-sheet → P/B, REIT → P/FCF, product → P/FCF
          → P/FCF derived by inverting the persisted yield snapshot (1/yield)
      · multiple_change_base = deriveMultipleChangeBase (annualized compression to min(current, median); 0 if current ≤ median)
      · multiple_change_stress = deriveMultipleChangeStress (annualized compression to Q1; 0 if current ≤ Q1)
      · OVERRIDE CARRY-FORWARD: read existing valuation; if multiple_change_*_override is non-null, it replaces the auto-derived value
      · peerMedians.ts: getPeerMedian({ sector, industry, multipleLabel }) — hardcoded Damodaran sectors + business-type sub-rules (key separator " - " matches yfinance industry strings exactly)
      · impliedReturn.ts: computeImpliedReturn → base/stress CAGR + verdict (two-step rule). Effective multiple_change_* = override ?? auto.
      · save with method='implied_return', assumptions = { fcf_yield, fcf_ttm, market_cap, growth, multiple_change_*, multiple_change_*_override, multiple_label, multiple_source, multiple_current/median/q1, multiple_base/stress_terminal, peer_median, peer_median_label, peer_median_source, threshold, floor, treasury_yield, base_cagr, stress_cagr, passes_*, verdict, verdict_reason, cross_check, relative_valuation }
```

Decision rule (two steps — both must pass):
1. **Atractivo:** baseCAGR ≥ tier threshold (Exceptional 12% / Good 14% / Mediocre 17%)
2. **No-desastre:** stressCAGR ≥ floor (Treasury 10y + 2%)

When the verdict is negative, `computeTargetBuyPrice` (in `lib/impliedReturn.ts`) inverts the formula on the FCF Yield component to surface the price at which both checks would pass — rendered as a white card inside the verdict zone.

Both `ensureValuation` (first render) and Iris's `refreshValuationOnly` (10-K + 10-Q hooks) go through the same `computeAndSaveValuation` helper — dispatch logic lives in one place. `qualityTier` is an optional 5th parameter on both signatures so callers that already loaded the analysis can pass it through; otherwise it's resolved internally.

User-edited DCF assumptions (`updateValuationAssumptionsAction`) go through pure recompute only — **no AI re-call**. The relative snapshot and the guide are preserved as-is. Note this action edits the legacy DCF cross-check.

**Implied-return overrides** (`updateImpliedReturnOverrideAction`, post-2026-04-27): Joseda can override four assumptions independently — **terminal multiple base / stress in Nx** and **growth base / stress in %/yr**. For multiples, the server converts Nx → annualized %/año via `multipleToAnnualizedChange`, persists in `multiple_change_*_override`. For growth, the server stores the decimal directly in `growth_*_override`. Both re-run `computeImpliedReturn` with effective values (override ?? auto). Reset clears the relevant override. Carry-forward in `computeAndSaveValuation` preserves overrides across natural regenerations — only the action itself can clear them. The disclaimer in `ImpliedReturnCalculator` (current/peer ≥ 1.5×) drives toward the multiple override; the latest-year subordinate line in `ScorecardCard` (e.g. ROIC 22% último año vs 28% mediana 10y) drives toward the growth override. Both editable via pencil ✎ buttons in the calculator's calculation table.

**Live verdict at today's price** (post-2026-04-27): `deriveLiveImpliedReturn(stored, currentMarketCap)` in `lib/impliedReturn.ts` re-runs the formula against today's quote without touching DB. Re-derives `fcf_yield`, `multiple_current` (linear scale by price ratio), `multiple_change_*` (against new current vs persisted median/q1, respecting overrides), and the resulting `base/stress_cagr` + `verdict`. Anchored assumptions stay frozen — growth, peer median, quality tier, etc. Applied at three surfaces: (a) watchlist list page (verdict chip per ticker, computed from live `quote.marketCap`); (b) position page (calculator entire); (c) watchlist[ticker] page (calculator entire). Cache (`valuations` row) keeps the snapshot from the last regenerate for trajectory history; the live derivation is purely render-side. Override fields are persisted as annualized rates and respected verbatim — the assumption is "user's intent at edit time", not "fixed terminal multiple".

**Unified ficha** at `/dashboard/ticker/[symbol]` (server component, post-2026-04-28 watchlist refactor). Single canonical surface for any company regardless of relationship. ViewMode is binary: `in_portfolio` (positions with net>0) vs `discovery` (everything else). Watchlist is an orthogonal flag — `isOnWatchlist` from `watchlist_entries`, surfaced as the ★ toggle in the header. Tabs (Negocio · Calidad · Valoración · Presentaciones · Decisión) render identically across both modes; only Overview branches (operations log + cost basis when owned, próxima presentación + funds-holding card otherwise). Legacy routes `/dashboard/position/[id]` and `/dashboard/watchlist/[ticker]` 308-redirect here.

### Cache philosophy

- **Per-ticker, shared across users:** `moat_assessments`, `valuation_guides`, `business_understanding`, `qualitative_red_flags`, `discovery_pre_analyses`. Refreshed via 10-K accession invalidation + the daily SEC signals cron (post-2026-04-28).
- **Per-position, per-user:** `moatboard_analyses`, `valuations`, `theses`. Overwritten on regenerate.
- **Always fresh:** fundamentals from yfinance (no cache — fast and free enough).

### Shared per-ticker analysis cache (post-2026-04-28)

`discovery_pre_analyses` is the global per-ticker view of Quality + Moat + Red flags. The model is **"analyze once, benefit all users"** — no agentic mass batch (killed because it consumed full Max tokens after 46 tickers).

Three populating paths:

1. **User completes wizard.** `advanceStepAction(ticker, 'valuation' | 'decision')` calls `upsertPreAnalysisFromExisting(ticker)` which lifts the rows the user just wrote (`moatboard_analyses` + `moat_assessments` + `qualitative_red_flags` + `sec_fundamentals_cache.latest_quarter_*`) into the shared row. Zero AI calls — pure DB read + upsert. Idempotent. Best-effort (errors logged, never block the wizard).

2. **New 10-K detected** (full IA refresh, ~1×/year/ticker amortized across users). The daily SEC signals cron (`runDailySignalsJob`) tracks newly-inserted 10-K accessions per ticker in `EnsureSignalsResult.newTenKAccessions`. Post-loop, for each ticker that (a) reported a fresh 10-K AND (b) already has a row in `discovery_pre_analyses`, calls `processPreAnalysisForTicker(ticker)` exactly once: re-runs Quality + Moat (via `runAnalysis` — moat is invalidated by accession via `isMoatStale`) + Red flags (`generateRedFlags` over Item 1A) + business understanding (`refreshUnderstandingIfStale`) + per-user valuations (`refreshValuationOnly` re-runs `computeAndSaveValuation` on every existing `valuations` row whose canonical matches; user growth/multiple overrides carry forward). 10-K/A amendments don't trigger — they touch the same fiscal year already processed.

3. **New 10-Q detected** (scorecard + valuation recompute, no AI). When `ensureQuarterlySnapshots` creates a `quarterly_10q` snapshot, it calls `refreshScorecardOnly(ticker)` which re-runs the scorecard with fresh SEC numbers, reuses cached moat (last_10k_accession unchanged means no IA invalidation), preserves existing red flag counts (Item 1A lives only in 10-K), and finally runs `refreshValuationOnly(ticker)` so per-user `valuations` rows pick up the new FCF TTM + multiple distributions (valuation guide cached 365d → no IA). Updates tier if numerics moved enough. Best-effort.

Tickers that fail the coverage gate (<5 applicable scorecard dimensions, e.g. recent IPOs / niche industries / broken data) get `status='not_covered'` with a reason — the leaderboard renders "no soportado" italic with the reason in tooltip instead of a silent dash.

The `tier_preset` column (default `'moatboard_default'`) lives on every row but ships with one preset only. The CAPA 1 (objective: scorecard, moat, red flags counts, 10-K accession) / CAPA 2 (opinion: tier + applicable_dimensions) split is preparation for future per-user presets — not active.

### Valuation UI — Implied Return Calculator (post-2026-04-25)

The Valuation section is now driven by `ImpliedReturnCalculator.tsx`, organised in three visual zones top→bottom:

**Zone 1 · Conclusión** (color-toned card by verdict tone)
- Veredicto label in editorial italic — "Comprable" / "No comprable — precio caro para la calidad" / "No comprable — riesgo asimétrico" / "No comprable — precio y riesgo no compensan".
- Two checks inline (Atractivo + No-desastre) with the actual numbers vs threshold/floor.
- When verdict is negative: white target-price card with `Comprable a partir de $X.XX (-Y%)` + binding constraint + inline rationale ("FCF Yield pasaría de current% → required%").

**Zone 2 · Cálculo** (white background, dense numbers)
- 3-column table: **Componente · Caso base · Estrés**.
- Rows: FCF Yield · + Crecimiento sostenible · + Δ Múltiplo (anualizado) · = CAGR esperado (bold).
- Two benchmark rows below the total: Umbral (under Base column) + Floor (under Estrés column) with checkmarks aligned with the column they compare against.

**Zone 3 · Detalles** (collapsed `<details>`, gray background)
- FCF Yield breakdown (FCF TTM / Market Cap).
- Crecimiento sostenible — anchors table with driver mark, formula and notes.
- Δ Múltiplo explanation (base = stable, stress = compression to Q1 or 0% when current ≤ Q1).
- Tier thresholds table with rationale for the current tier, plus floor.
- Link to `/dashboard/learn/valuation` (full pedagogical page, 7 sections).

Below the calculator, a single collapsed `<details>` "Otros métodos de valoración · contexto histórico + cross-check" contains:
- **Contexto histórico:** PE / P/FCF / P/B distribution panels vs the business's own history (the same tools that were the v1 toolkit).
- **Cross-check absoluto:** the legacy DCF / AFFO / Excess Returns / AI multiples result, rendered with explicit note "Para compounders de calidad sistemáticamente dicen 'Premium' — útil para detectar precios absurdos, no como veredicto".

The `IV/Price` ratio and `MoS%` are still computed internally (`valuation.ts`) and persisted as part of `cross_check`. The `dcf_tier`, `relative_tier`, `tier` (compound) columns remain for legacy DB rows — not read by the implied-return UI. Philosophy rationale: see philosophy-review drift M (2026-04-16) and the 2026-04-25 redesign of Valuation as implied-return-primary documented in `../moatboard-app/BACKLOG.md` (entry "Cross-sectional anchor + override editable del stress" for what's still pending).

## Conventions

### Next.js 16 specifics

- Use `src/proxy.ts` for auth gating, **not** `middleware.ts` (deprecated in v16). Export must be named `proxy` or default function.
- Server Components by default. Add `"use client"` only for components that need state, effects, or event handlers.
- Server Actions live next to the page (`actions.ts` co-located).
- App Router only. No Pages Router.

### Anthropic SDK — lazy instantiation (mandatory)

The SDK does browser-detection in its constructor. If a client component imports any value (not just types) from a module that does `new Anthropic()` at module load, the bundler pulls the SDK into the client and the constructor throws `dangerouslyAllowBrowser`. Pattern used throughout `lib/*Ai.ts`:

```ts
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}
```

### TypeScript types

- `Tier = 'exceptional' | 'good' | 'mediocre' | 'poor'` exported from `lib/verdict.ts` (note: `mediocre` replaced the old `average` after drift L fix)
- `ValuationMethod = 'implied_return' | 'dcf' | 'affo_dcf' | 'excess_returns' | 'ai_multiples'` exported from `lib/valuations.ts`. The stored `assumptions` JSONB shape depends on `method`: `ImpliedReturnStoredAssumptions` (primary since 2026-04-25 — carries fcf_yield, fcf_ttm, market_cap, growth {base/stress/optimistic/anchors/driver}, multiple_change_*, threshold, floor, base_cagr, stress_cagr, verdict + verdict_reason, optional cross_check, relative_valuation), `DcfStoredAssumptions`, `ExcessReturnsStoredAssumptions`, `AiMultiplesStoredAssumptions` (legacy, also used inside cross_check).
- `DcfTier = MosTier = 'margin' | 'acceptable' | 'fair' | 'premium'` exported from `lib/valuation.ts` — kept for the internal DCF classifier only. Not surfaced in UI.
- `RelativeTier`, `CompoundTier` also in `lib/valuation.ts` — legacy, still persisted but not shown
- `ToolId = 'dcf' | 'pe' | 'pfcf' | 'pb' | 'cash_yield'` exported from `lib/valuationGuideAi.ts`. The type still carries `cash_yield` for backwards compatibility with historical `valuation_guides` rows, but the AI prompt no longer recommends it and the UI never renders a `cash_yield` tool in the valuation section (it moved to Additional Signals).
- `MoatStrength`, `MoatArchetype` exported from `lib/verdict.ts`
- `ThesisContent`, `ThesisField` exported from `lib/thesis.ts`
- Database row types use snake_case field names (matching Postgres columns); business logic types use camelCase

### Tailwind palette

Custom navy scale defined in `src/app/globals.css` (`--color-navy-50` through `--color-navy-950`). Use `text-navy-900`, `bg-navy-50`, etc. — not arbitrary hex codes.

**Color vocabulary:**
- **Quality Scorecard (tier color is intentional — quality is defensibly binarizable in Buffett's own vocabulary):**
  - emerald = exceptional
  - teal = good
  - amber = mediocre
  - red = poor
- **Valuation section (no tier color on the bars — four independent tools, user weighs):**
  - blue = neutral bars across all valuation widgets (DCF range bar, PE/P-FCF/P-B distribution bars, current markers)
  - navy = containers, text, labels
  - emerald = AI Valuation Guide "Primary" and "Secondary" tool labels (trust signal)
  - red = AI Valuation Guide "Interpret with care" tool label (warning signal) — wording was deliberately chosen over "Use with caution" because the former makes clear it's still useful data, just needs context, not that the tool is dangerous
- **Per-metric quality badges in the scorecard** (emerald/teal/amber/red) — strong/good/mixed/weak on individual metrics like ROIC, FCF margin.

## Development Commands

```bash
npm run dev       # Start dev server (Turbopack)
npm run build     # Production build (catches TS errors)
npm run lint      # ESLint
node scripts/init-db.mjs   # Apply schema (drops + recreates as needed)
```

## Environment Variables

Required in `.env.local` (gitignored, mirrored in Vercel):

```
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
AUTH_SECRET=...                  # openssl rand -base64 32
AUTH_URL=http://localhost:3000   # production: https://www.moatboard.com
DATABASE_URL=postgresql://...    # Neon pooled connection string
ANTHROPIC_API_KEY=sk-ant-...         # used by remote mode (production) and any direct SDK calls
SEC_USER_AGENT=Name Email            # SEC EDGAR requires a declarative UA
CRON_SECRET=...                      # Vercel Cron Bearer token (production only; set locally only if testing protected mode)

# Dual-mode Claude caller — see src/lib/claudeClient.ts
MOATBOARD_AI_MODE=local              # local-only. Omit or set to 'remote' for API path. Vercel uses 'remote' by not setting this.
CLAUDE_CLI_PATH=/Users/joseda/.local/bin/claude   # optional, only if CLI lives elsewhere
CLAUDE_CLI_MODEL=opus                # optional, defaults to "opus" (the Max alias for the current Opus)
```

**Verification:** after changing anything in the dual-mode path run `node scripts/smoke-claude-client.mjs` — smoke test hits the CLI for both a text completion and a JSON-schema completion, fails loud if either breaks. The script does NOT touch the DB.

## Sanity-check Tickers

Dogfood portfolio (loaded 2026-04-18 via `scripts/reset-portfolio-fundsmith-us.mjs`): 11 US-listed Fundsmith holdings (MAR, SYK, WAT, V, PM, IDXX, GOOGL, ZTS, INTU, FTNT, META). Framework should classify most as Good or Exceptional — outliers are signal, not noise (either a framework gap or a Terry Smith view the framework doesn't capture).

When testing the verdict + valuation pipeline:
- **AAPL / MSFT** — Exceptional compounders. Method = `"dcf"`. AI guide should flag pfcf primary and pe/dcf secondary (SBC noise on PE).
- **V / MA** — Credit Services. Scored as product businesses (not balance-sheet), method = `"dcf"`.
- **JPM** — bank. `isBalanceSheetBusiness` true. Method should be `"excess_returns"` (Damodaran model). AI guide should flag P/B primary. Useful stress test of the CAPM + ROE dispatch.
- **O / AMT / VICI** — REIT (equity). `isRealEstate` true, `isBalanceSheetBusiness` false. Method = `"affo_dcf"` with reasoning text calling out the AFFO approximation.
- **RITM / AGNC** — mortgage REIT. `isBalanceSheetBusiness` true (balance-sheet wins over real-estate for mREITs). Method = `"excess_returns"`.
- **UNH / HUM** — health insurer ("Healthcare Plans"). `isBalanceSheetBusiness` true. Method = `"excess_returns"`.
- **CVNA / GME** — should be Poor (high debt / no moat).
- **RDDT / ASTS** — recent IPO / pre-commercial. Should hit the "Moatboard can't analyze" gate (fewer than 5 applicable scorecard dimensions, or AI multiples + op margin worst < −50%).

## Pending Decisions

- **AI thesis on Invest (deferred, 2026-04-19).** Originally planned as part of the wizard's Decision step. The Decision step is gone (post-2026-04-28 refactor) and buying lives on `/dashboard/comprar/[ticker]`. The combination of `fundamentals_snapshots` (frozen quantitative picture) + `positions.pre_commitment_md` (compromiso de salida — required on first buy) + `position_transactions.pre_commitment_md` (per-op note) may already cover what an AI thesis would add. If kept, wire `generateAiThesisAction` into `recordBuyTransactionAction` in `/dashboard/comprar/[ticker]/actions.ts`.

## Important Rules

- **Do not change scorecard / verdict / valuation logic without first re-reading `../Context/buffett-munger-philosophy-review.md`.** That document defines the philosophical north star and lists 12 specific drifts the product needs to evolve toward closing.
- **Language split**: UI chrome (nav, labels, homepage, /about, /pricing) stays in English — full i18n is deferred. AI-generated content (business understanding, red flags, verdict prose, moat reasoning, valuation guide, AI thesis, multiples fallback reasoning) runs in Spanish from day 1. Financial jargon (ROIC, FCF, DCF, moat, PE, P/FCF, P/B, capex, SBC, etc.) stays in English inside Spanish prose.
- Calm, deliberate UX. Every change passes the anti-trading test: "does this incentivize trading or compulsive checking?" If yes, discard.
- Fundamentals are fetched through `fetchMultiYearFundamentals` which is SEC-first with a per-field yfinance merge for `sharesDiluted` (Visa-class tickers don't XBRL-tag share counts). Quote + trailing fundamentals still come directly from yfinance each call.
- Moat assessments and valuation guides are cached per ticker, shared across users. Invalidate after significant prompt changes.
- AI is used for: business understanding + follow-up Q&A, qualitative red flags, moat strength + archetype + reasoning, verdict prose, DCF assumptions, multiples fallback, AI thesis. Everything else is deterministic.
