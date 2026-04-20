# Moatboard App - Development Instructions

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript + Turbopack
- **CSS:** Tailwind CSS v4 (custom navy palette in `globals.css`)
- **Hosting:** Vercel (auto-deploy from GitHub `Josedapo/moatboard` on push to `main`)
- **Database:** Vercel Postgres (Neon) via `@neondatabase/serverless`
- **Auth:** NextAuth.js v5 (Auth.js beta) — Google OAuth only (magic link not configured)
- **AI:** Anthropic SDK — model `claude-sonnet-4-6` everywhere, lazy-instantiated
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
│       ├── page.tsx                   # Portfolio list (filters by net shares > 0; counters for watchlist/parked; "Próximas presentaciones" block; per-ticker new-signal badge)
│       ├── actions.ts                 # startAnalysisAction, reanalyzeTickerAction, deletePositionAction, markSignalReviewedAction, reopenSignalAction, summarizeSignalAction
│       ├── inbox/page.tsx             # Pending signals (status=new only), grouped by ticker, heartbeat line, nav badge count
│       ├── watchlist/page.tsx         # Tickers on watchlist. Each row links to watchlist/[ticker]
│       ├── watchlist/[ticker]/page.tsx # Dedicated per-ticker view — NextEarningsCard + PresentationsPanel (no ficha for watchlist tickers)
│       ├── history/page.tsx           # Discarded + Outside circle tickers; "Was held" badge → "Open ficha →" for closed positions
│       ├── api/cron/signals/route.ts  # Vercel Cron endpoint (0 7 * * * UTC, CRON_SECRET-protected) — invokes runDailySignalsJob + expireOldSignals
│       ├── analyze/[ticker]/
│       │   ├── page.tsx               # Wizard dispatch (reads analysis_sessions.current_step, renders corresponding Step*) — 5 steps after business_type was consolidated into Quality
│       │   └── actions.ts             # advanceStepAction, navigateToStepAction, decide{Invest,Watchlist,Discard}, markOutsideCircleAction, askFollowupAction, regenerate{Understanding,RedFlags}Action, exit/restart
│       └── position/[id]/
│           ├── page.tsx               # Tabbed position detail (Overview / Negocio / Calidad / Valoración / Presentaciones) + chrome (header w/ 52w mini-bar, Decision context strip, "Ver evolución" outline button). Overview includes NextEarningsCard on top.
│           ├── actions.ts             # runAnalysisAction, runValuationAction, thesis actions, updatePositionPreCommitmentAction, addOperationAction
│           └── trajectory/            # URL stays /trajectory for bookmark stability; user-facing label is "Evolución"
│               ├── page.tsx           # Full Evolución view — builds synthetic "hoy" pseudo-snapshot (id=-1), loads preloaded moat validations, renders TrajectoryExplorer
│               └── actions.ts         # revalidateMoatAction — writes to moat_validations table, does NOT touch moat_assessments cache
├── components/                        # All UI components (mix of Server + Client)
│   ├── AnalyzeEntryForm.tsx           # Dashboard entry: ticker input → startAnalysisAction → wizard. Renders prior-state reminder + Re-analyze anyway button when re-introducing a parked ticker.
│   ├── DashboardNav.tsx               # Server nav frame; reads `new` signal count via sql query and passes to DashboardNavLinks for the Inbox badge.
│   ├── DashboardNavLinks.tsx          # Client links (Portfolio · Watchlist · History · Inbox) with active state + amber count badge on Inbox
│   ├── SignalsInbox.tsx               # Server. Inbox list component shared by /dashboard/inbox; groups signals by ticker + heartbeat line consuming `cron_runs`.
│   ├── SignalCard.tsx                 # Client. Per-signal card with severity frame (emerald floor / amber material / navy informational), EDGAR + Evolución links, AI summary (collapsible), actions. `mode` prop: `new` shows "Marcar revisada"; `reviewed` desaturates + ✓ + "Reabrir".
│   ├── UpcomingEarnings.tsx           # Server. Dashboard "Próximas presentaciones" — one row per portfolio + watchlist ticker with known earningsDate. Information, not alert.
│   ├── MoatboardAnalysis.tsx          # Scorecard UI (accepts `hideRegenerate` for wizard use)
│   ├── Valuation.tsx                  # Valuation toolkit UI (recommended tools visible by default; rest in <details>; Reading Signal filtered to recommended)
│   ├── Thesis.tsx                     # AI/user thesis UI (still in repo; not currently rendered on the position page after the 2026-04-20 redesign)
│   ├── BusinessDescription.tsx        # Stateless paragraph splitter for Yahoo summary
│   ├── analysis/                      # Wizard-specific components
│   │   ├── WizardShell.tsx            # Step indicator (5 steps; past steps clickable via furthest_step tracking) + exit/restart
│   │   ├── StepUnderstanding.tsx      # Wraps shared/BusinessUnderstandingView; checkpoint (Sí entiendo / Con dudas / No lo entiendo)
│   │   ├── StepRedFlags.tsx           # Wraps shared/RedFlagsList; "Continuar al análisis de calidad" + "Saltar a la decisión"
│   │   ├── BusinessTypeHeader.tsx     # Compact pill + chips renderered at the top of StepQuality (no longer its own step)
│   │   ├── StepQuality.tsx            # Renders BusinessTypeHeader + MoatboardAnalysis; "Continue to valuation" + "Skip to decision"; gates <5 dims
│   │   ├── StepValuation.tsx          # Reuses ValuationSection with the guide
│   │   ├── StepDecision.tsx           # Invest form captures position_pre_commitment (optional) + operation_note (optional) + price/shares/date; Watchlist + Discard
│   │   └── FollowupChat.tsx           # Client-only chat input for understanding follow-ups
│   ├── position/                      # Position-page-specific components
│   │   ├── PositionTabs.tsx           # Client tab shell (Overview / Negocio / Calidad / Valoración / Presentaciones) — useState, panels rendered server-side, optional `badges` prop for per-tab numeric counts (used on Presentaciones for pending signals)
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
│   ├── financial.ts                   # yahoo-finance2 wrapper; fetchMultiYearFundamentals merges SEC with yfinance for sharesDiluted when SEC leaves it all-null
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
│   ├── valuation.ts                   # Pure DCF (two-stage owner earnings) + tier types
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
│   ├── tickerStates.ts                # CRUD for ticker_states (in_portfolio / watchlist / discarded / outside_circle)
│   ├── analysisSessions.ts            # CRUD for analysis_sessions (current_step + furthest_step + outcome)
│   ├── snapshots.ts                   # CRUD for fundamentals_snapshots + diffSnapshots
│   ├── sec.ts                         # SEC EDGAR integration; persists latestFiling (accession/period/form/filed) for quarterly snapshot triggering
│   └── secParser.ts                   # XBRL parser; extractLatestFiling walks raw_facts to find most recent 10-Q/10-K
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

Tables:
- `users`, `accounts`, `sessions`, `verification_token` — NextAuth (Neon adapter)
- `positions` — user portfolio entries (`user_id`, `ticker`, `pre_commitment_md`, `pre_commitment_edited_at`, `created_at`). `pre_commitment_md` is the position-level "compromiso de salida" — what would make Joseda lose confidence in this investment. Editable, optional. Cost basis lives in `position_transactions`. Dashboard filters by **net shares > 0** (sum of buys+adds − trims−sells) so closed positions and drafts both disappear from Portfolio automatically.
- `position_transactions` — log of `buy`/`add`/`trim`/`sell` per position (Trim retired from UI 2026-04-20; CHECK still allows it for legacy rows). Each row has `transaction_date`, `price`, `shares`, and optional `pre_commitment_md`. **Semantics shifted 2026-04-20:** the column is now the **operation note** ("why this op"), not a per-transaction pre-commitment. Column name kept for back-compat. Cost basis derived (`getCostBasis`).
- `fundamentals_snapshots` — immutable frozen frames, per-user per-ticker. `trigger` ∈ `transaction` / `quarterly_10q` / `annual_10k`. Stores tier, scorecard_summary, multi_year, moat JSONB, valuation method + IVs + assumptions + guide, business_understanding_version, thesis_snapshot, current_price, sec_filing_accession. Partial unique index on `(user_id, ticker, sec_filing_accession) WHERE sec_filing_accession IS NOT NULL` prevents duplicating a filing's snapshot.
- `business_understanding` — AI-generated plain-language summary per ticker, versioned. PK `(ticker, version)`. Regeneration archives the previous row (`archived_at`). Stores `summary_md` (JSON-serialized section list), `questions_and_answers` (pregenerated + user follow-ups), `sources`.
- `qualitative_red_flags` — per-ticker AI-extracted red flags (`flags` JSONB by category + severity). Tracks `last_10k_accession` for invalidation.
- `ticker_states` — per-user ticker lifecycle: `in_portfolio` / `watchlist` / `discarded` / `outside_circle`. Carries `reason_md` + `review_when` + `prior_reason_on_invest_md` (preserves the previous reason when a ticker that was discarded/watchlisted is re-bought, surfaced by `DecisionContextStrip`). Sell-to-zero auto-flips to `discarded`; Add on a closed position auto-resurrects to `in_portfolio`.
- `analysis_sessions` — wizard state per `(user_id, ticker)`. `current_step` ∈ `understanding`/`red_flags`/`quality`/`valuation`/`decision`/`completed` (5 active steps; `business_type` was removed 2026-04-20 when it consolidated into `quality`). `furthest_step` drives backward navigation. `outcome` + `completed_at` on terminal decisions. Partial unique index enforces one active session per ticker.
- `moat_assessments` — **per-ticker, shared across users**, AI-evaluated, TTL 365 days. Reasoning now in Spanish. **Never written from the trajectory view** — that path uses `moat_validations` to avoid invisible side-effects on the main ficha + other users + future snapshots.
- `moat_validations` — **per-user, per-snapshot** comparative moat validations (the output of the trajectory "Validar con IA" button). Each row is immutable; multiple validations against the same `from_snapshot_id` are allowed so the table doubles as a revalidation history. Carries the verdict (`intact` / `expanding` / `compressing` / `dissolved`), the original moat at the moment of validation, and the fresh moat read. Created 2026-04-20 via additive migration `scripts/add-moat-validations-table.mjs`.
- `valuation_guides` — **per-ticker, shared across users**, AI-generated advice on which valuation tools matter most (primary/secondary/cautious + reasoning). Reasoning in Spanish. TTL 365 days.
- `moatboard_analyses` — per-position verdict (tier, verdict_reason, scorecard_summary, moat snapshot). Verdict prose now in Spanish.
- `valuations` — per-position IV + MoS (method, intrinsic_value range, current_price, dcf_tier, relative_tier, compound tier, assumptions JSONB including RelativeValuationSnapshot). `method` CHECK constraint allows `'dcf' | 'affo_dcf' | 'excess_returns' | 'ai_multiples'`. Note: the compound `tier`, `dcf_tier` and `relative_tier` columns are legacy — still persisted but no longer read by the UI (see philosophy-review drift M correction, 2026-04-16). The per-method `assumptions` shape differs (owner-earnings DCF, AFFO DCF, Excess Returns, AI multiples)
- `theses` — per-position user thesis (source: 'user' | 'ai', raw_text, structured_content JSONB, `pre_commitment_md`). AI generation is in Spanish; not auto-invoked from the wizard today (decision deferred — see Pending Decisions).
- `sec_fundamentals_cache` — raw XBRL + parsed_annual + `latest_quarter_{accession,period_end,form,filed}` for quarterly snapshot triggering. `parsed_quarterly` column exists but not yet populated.
- `review_signals` — **per-user SEC signal inbox** (Phase 6). One row per (user, ticker, accession). Lifecycle `new` → `reviewed` from UI (legacy `dismissed`/`expired` kept in CHECK for forward compat, not written from UI). Carries source (sec_8k/sec_10q/sec_10k/sec_10qa/sec_10ka), event_type + severity (floor/material/informational), source_url (EDGAR), raw_payload (form + items), summary_md + summarized_at + summarized_with_model (AI plain-language summary, lazy-filled on demand). Populated by the daily Vercel Cron.
- `moat_validations` — **per-user, per-snapshot** comparative moat validations (output of the trajectory "Validar con IA" button). Immutable rows; revalidation history.
- `cron_runs` — heartbeat log for every cron run (started_at, finished_at, ok, processed_tickers, inserted_signals, error_count, error_summary). Consumed by SignalsInbox for "última verificación hace Xh".
- `monthly_reviews` — placeholder, kept for possible future ceremonial anual review (Phase 6 pending).

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

### Valuation pipeline

```
quote + fundamentals + multi-year + treasury + relative-history (yfinance, parallel)
  → Business-type dispatch (positionFlow.ts: computeAndSaveValuation):
      · isBalanceSheetBusiness(sector, industry) (banks, insurers, asset mgrs, health insurers, mortgage REITs)
          → valuation.ts: computeExcessReturnsBase / computeCostOfEquity (CAPM rf + β × 5% ERP)
          → valuation.ts: computeExcessReturnsValuation / computeExcessReturnsRange
          → method: "excess_returns"   (fallback: ai_multiples if ROE unstable / BV ≤ 0)
      · isRealEstate(sector) (excluding mortgage REITs — they go via balance-sheet)
          → same owner-earnings math, relabeled as AFFO proxy (NI + D&A − 5y avg capex)
          → method: "affo_dcf"
      · else (product businesses):
          → valuation.ts: computeOwnerEarningsBase(), observedGrowthRate()
          → valuation.ts: computeIntrinsicValueRange() (pure, 10%/12%/14% hurdle rates)
          → method: "dcf"
      · AI multiples fallback (when the absolute method is not computable):
          → valuationAi.ts: estimateWithMultiples() (1 Claude call) → method: "ai_multiples"
  → positionFlow.ts: computeRelativeValuationContext() (pure)
      → relativeValuation.ts: computeDistributionStats() for PE, P/FCF, P/B
      → current percentile vs own-history distribution (IQR outlier trimmed)
  → valuationGuides.ts: ensureValuationGuide() (get-or-create, cached per ticker)
      → on miss → valuationGuideAi.ts: assessValuationGuide() (1 Claude call)
  → save to valuations (valuation row per position + guide row per ticker)
```

Both `ensureValuation` (first render) and `runValuationAction` (user-triggered regenerate) go through the same `computeAndSaveValuation` helper — dispatch logic lives in one place.

**No compound verdict on valuation.** The UI renders 4-5 independent tools side by side (DCF range, PE-own-history, P/FCF-own-history, P/B-own-history when book value positive, Cash yield vs 10y Treasury) + the AI guide at the top indicating which tools matter most for the business type. See philosophy-review drift M and its 2026-04-16 correction.

User-edited DCF assumptions (`updateValuationAssumptionsAction`) go through pure recompute only — **no AI re-call**. The relative snapshot and the guide are preserved as-is.

### Cache philosophy

- **Per-ticker, shared across users:** `moat_assessments`, `valuation_guides`. Refreshed yearly via TTL. Future Quality Universe will batch-populate `moat_assessments`.
- **Per-position, per-user:** `moatboard_analyses`, `valuations`, `theses`. Overwritten on regenerate.
- **Always fresh:** fundamentals from yfinance (no cache — fast and free enough).

### Valuation toolkit (replaces the old "Margin of Safety" verdict)

The Valuation section renders **four independent tools**, navy-neutral, no red/green semantics on the bars, no single verdict. The user weighs them by the kind of business (the AI Valuation Guide at the top suggests the weighting, but never hides a tool):

1. **Intrinsic value · {method-specific label}** — the absolute-valuation tool. Method adapts to the business type: **Owner earnings two-stage DCF** (product businesses) · **AFFO-based DCF** (REITs, same math relabeled) · **Excess Returns Model** (banks / insurers: book value + PV of (ROE − Ke) × BV over 10y, Ke via CAPM) · **AI multiples fallback** (when no absolute method applies). All four render the same Bear / Base / Bull range bar + price marker for visual consistency.
2. **PE ratio · vs own history** — current PE vs the business's own 5-7y distribution. Blue mini-bar with Min / Q1 / Median / Q3 / Max + current marker.
3. **P/FCF ratio · vs own history** — same layout. Inverted from FCF-yield snapshot at display time.
4. **P/B ratio · vs own history** — only shown if book value has been positive across the history. Primary tool for financials and asset-heavy businesses.

Cash yield vs Treasury was **retired from the valuation toolkit** (2026-04-18) — it's an indicator of price attractiveness, not a valuation method, so it lives as a context card under "Additional Signals" instead of alongside DCF / PE / P/FCF / P/B.

The `IV/Price` ratio and `MoS%` are still computed internally (`valuation.ts`) and persisted, but they're no longer surfaced as a colored tier. The `dcf_tier`, `relative_tier`, `tier` (compound) columns remain for legacy DB rows — not read by the UI. Philosophy rationale: see drift M and its 2026-04-16 correction in `../Context/buffett-munger-philosophy-review.md`.

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
- `ValuationMethod = 'dcf' | 'affo_dcf' | 'excess_returns' | 'ai_multiples'` exported from `lib/valuations.ts`. The stored `assumptions` JSONB shape depends on `method` (`DcfStoredAssumptions`, `ExcessReturnsStoredAssumptions`, `MultiplesStoredAssumptions`).
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
ANTHROPIC_API_KEY=sk-ant-...
SEC_USER_AGENT=Name Email            # SEC EDGAR requires a declarative UA
CRON_SECRET=...                      # Vercel Cron Bearer token (production only; set locally only if testing protected mode)
```

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

## Known Limitations (tech debt to address)

- **Business understanding (Step 1) is not anchored in the real 10-K.** The AI generator uses yfinance's short business summary plus Claude's general knowledge of the company. For well-known tickers (V, AAPL, MSFT) this produces accurate summaries; for obscure or recent tickers Claude may hallucinate. Real fix: fetch the 10-K Item 1 (Business) and the latest earnings-call transcript from SEC EDGAR, pass them into the prompt, and cite the source. **Same gap applies to Step 2 (Red Flags)** — the AI works off training data, not the real filing.

## Pending Decisions

- **AI thesis on Invest (deferred, 2026-04-19).** The plan had the Decision step auto-generate a structured AI thesis when the user clicks Invest. Postponed: the combination of `fundamentals_snapshots` (frozen quantitative picture) + `position_transactions.pre_commitment_md` (the "what would make me change my mind" text) may already cover what an AI thesis would add. Decide once the full wizard + monthly review flow is in use. If kept, the existing `generateAiThesisAction` from the position page can be wired into `decideInvestAction`.

## Important Rules

- **Do not change scorecard / verdict / valuation logic without first re-reading `../Context/buffett-munger-philosophy-review.md`.** That document defines the philosophical north star and lists 12 specific drifts the product needs to evolve toward closing.
- **Language split**: UI chrome (nav, labels, homepage, /about, /pricing) stays in English — full i18n is deferred. AI-generated content (business understanding, red flags, verdict prose, moat reasoning, valuation guide, AI thesis, multiples fallback reasoning) runs in Spanish from day 1. Financial jargon (ROIC, FCF, DCF, moat, PE, P/FCF, P/B, capex, SBC, etc.) stays in English inside Spanish prose.
- Calm, deliberate UX. Every change passes the anti-trading test: "does this incentivize trading or compulsive checking?" If yes, discard.
- Fundamentals are fetched through `fetchMultiYearFundamentals` which is SEC-first with a per-field yfinance merge for `sharesDiluted` (Visa-class tickers don't XBRL-tag share counts). Quote + trailing fundamentals still come directly from yfinance each call.
- Moat assessments and valuation guides are cached per ticker, shared across users. Invalidate after significant prompt changes.
- AI is used for: business understanding + follow-up Q&A, qualitative red flags, moat strength + archetype + reasoning, verdict prose, DCF assumptions, multiples fallback, AI thesis. Everything else is deterministic.
