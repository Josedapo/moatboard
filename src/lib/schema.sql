-- Moatboard database schema
-- Tables required by @auth/neon-adapter (NextAuth.js v5) + Moatboard domain

-- NextAuth.js tables
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  -- Moatboard fields
  plan VARCHAR(20) NOT NULL DEFAULT 'free',
  punch_card_used INTEGER NOT NULL DEFAULT 0,
  punch_card_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Moatboard domain tables
--
-- A `position` is the user's ownership of a ticker (0-to-many transactions below).
-- Purchase price/date moved to `position_transactions` on 2026-04-19 to support
-- multiple buys/adds/trims/sells per ticker. Cost basis is derived from the
-- transaction log, not stored here.
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  -- "What would have to happen for me to lose confidence in this investment?"
  -- Position-level commitment, not per-transaction. Optional at first buy
  -- (can be added later from the position page). Anchors anti-trading
  -- behaviour during price drama. See position_transactions.pre_commitment_md
  -- for the per-operation note (different concept).
  pre_commitment_md TEXT,
  pre_commitment_edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);

-- Legacy columns removed 2026-04-19. The ALTERs are kept idempotent so existing
-- DBs migrate safely; new DBs never see these columns (they're excluded from
-- the CREATE TABLE above).
ALTER TABLE positions DROP COLUMN IF EXISTS purchase_price;
ALTER TABLE positions DROP COLUMN IF EXISTS purchase_date;

-- Backfill on existing DBs (additive — no migration risk).
ALTER TABLE positions ADD COLUMN IF NOT EXISTS pre_commitment_md TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS pre_commitment_edited_at TIMESTAMPTZ;

-- Valuation guide: AI-generated suggestion of which valuation tools matter
-- most for a given business type (bank → P/B primary; SaaS → P/FCF primary;
-- etc.). Cached per ticker shared across users, TTL 365d. The nature of a
-- business is stable, so we don't regenerate every month.
CREATE TABLE IF NOT EXISTS valuation_guides (
  ticker VARCHAR(10) PRIMARY KEY,
  primary_tool VARCHAR(20) NOT NULL CHECK (primary_tool IN (
    'dcf', 'pe', 'pfcf', 'pb', 'cash_yield'
  )),
  secondary_tool VARCHAR(20) CHECK (secondary_tool IS NULL OR secondary_tool IN (
    'dcf', 'pe', 'pfcf', 'pb', 'cash_yield'
  )),
  cautious_tool VARCHAR(20) CHECK (cautious_tool IS NULL OR cautious_tool IN (
    'dcf', 'pe', 'pfcf', 'pb', 'cash_yield'
  )),
  reasoning TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_with_model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6'
);

-- Moat assessments cached per ticker, shared across all users (one row per ticker)
CREATE TABLE IF NOT EXISTS moat_assessments (
  ticker VARCHAR(10) PRIMARY KEY,
  strength VARCHAR(10) NOT NULL CHECK (strength IN ('strong', 'weak', 'unclear')),
  archetype VARCHAR(30) NOT NULL CHECK (archetype IN (
    'brand', 'network_effects', 'switching_costs', 'scale',
    'ip', 'regulatory', 'cost_advantage', 'none'
  )),
  reasoning TEXT NOT NULL,
  -- Literal English excerpt from the 10-K that grounds the moat claim.
  -- Optional: pre-2026-04-27 rows lacked filing context; null means the
  -- moat was inferred without primary-source citation.
  source_excerpt TEXT,
  -- The 10-K this moat was evaluated against. Used by the staleness
  -- check: a moat tied to an outdated accession is regenerated when SEC
  -- publishes a newer annual filing (parallels business_understanding).
  last_10k_accession VARCHAR(30),
  last_10k_period_end DATE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_with_model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6'
);

-- Per-user, per-snapshot comparative moat validations. Each row answers
-- "is the moat registered in this snapshot still in force?" and is the
-- output of the trajectory-screen "Validar con IA" button. Deliberately
-- kept OUT of moat_assessments so exploratory revalidations from the
-- trajectory don't silently mutate the ticker-wide cache that the main
-- position card and future quarterly snapshots read from. Multiple rows
-- per (user, snapshot) are allowed — the log doubles as revalidation
-- history.
CREATE TABLE IF NOT EXISTS moat_validations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  -- The snapshot supplying the "original" moat being revalidated.
  from_snapshot_id INTEGER NOT NULL REFERENCES fundamentals_snapshots(id) ON DELETE CASCADE,
  -- Copy of the original moat for immutability. If moat_assessments ever
  -- gets overwritten elsewhere, this row still shows what the validation
  -- was comparing against.
  original_archetype VARCHAR(30) NOT NULL,
  original_strength VARCHAR(10) NOT NULL,
  original_reasoning TEXT NOT NULL,
  original_recorded_at TIMESTAMPTZ NOT NULL,
  -- The AI's verdict and fresh moat read.
  verdict VARCHAR(15) NOT NULL CHECK (verdict IN ('intact', 'expanding', 'compressing', 'dissolved')),
  new_archetype VARCHAR(30) NOT NULL CHECK (new_archetype IN (
    'brand', 'network_effects', 'switching_costs', 'scale',
    'ip', 'regulatory', 'cost_advantage', 'none'
  )),
  new_strength VARCHAR(10) NOT NULL CHECK (new_strength IN ('strong', 'weak', 'unclear')),
  reasoning TEXT NOT NULL,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_with_model VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS moat_validations_from_snapshot_idx ON moat_validations(from_snapshot_id);
CREATE INDEX IF NOT EXISTS moat_validations_position_idx ON moat_validations(position_id);

-- Review signals — event-driven review workflow (Phase 6).
-- One row per (user, ticker, dedup_key). Generated daily by the SEC
-- EDGAR cron that scans new 10-Q/10-K and 8-K filings with material
-- Item codes for every ticker in the user's portfolio or watchlist.
-- The table is the single inbox of "things worth checking" — no price
-- alerts, no analyst upgrades, no social noise. Deliberately per-user:
-- discarded tickers don't generate rows here.
CREATE TABLE IF NOT EXISTS review_signals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,

  -- Source + event classification
  source VARCHAR(20) NOT NULL CHECK (source IN (
    'sec_8k', 'sec_10q', 'sec_10k', 'sec_10qa', 'sec_10ka',
    'snapshot_diff', 'discovery_13f', 'sec_form4'
  )),
  event_type VARCHAR(40) NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,

  -- Source reference (SEC accession for now; url rebuilt when needed)
  source_ref VARCHAR(50) NOT NULL,
  source_url TEXT,

  -- Severity + status
  severity VARCHAR(20) NOT NULL CHECK (severity IN (
    'floor', 'material', 'informational'
  )),
  status VARCHAR(15) NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'reviewed', 'dismissed', 'expired'
  )),

  -- Review bookkeeping. `reviewed_by_snapshot_id` links the signal to
  -- the fundamentals_snapshots row that was created or touched during
  -- the review (e.g. a 10-Q floor satisfied by opening /trajectory and
  -- validating the moat).
  reviewed_at TIMESTAMPTZ,
  reviewed_by_snapshot_id INTEGER REFERENCES fundamentals_snapshots(id) ON DELETE SET NULL,
  review_note_md TEXT,
  dismiss_reason_md TEXT,

  -- Raw payload for debugging + re-rendering. `summary_md` is an
  -- optional plain-language Spanish summary generated by Claude on user
  -- demand (never auto — LLM cost is user-controlled). The three
  -- `summarized_*` columns stay null until the first time the user
  -- clicks "Resumir con IA" on a signal.
  raw_payload JSONB,
  summary_md TEXT,
  summarized_at TIMESTAMPTZ,
  summarized_with_model VARCHAR(50),

  -- Dedup key: SEC accession for filings. Uniqueness is per-user so
  -- the same filing can exist for multiple users without collision.
  deduplication_key TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS review_signals_dedup_idx
  ON review_signals(user_id, ticker, deduplication_key);
CREATE INDEX IF NOT EXISTS review_signals_status_idx
  ON review_signals(user_id, status, event_date DESC);
CREATE INDEX IF NOT EXISTS review_signals_ticker_idx
  ON review_signals(ticker, event_date DESC);

-- Cron heartbeat — every cron run inserts one row so the UI can show
-- "last check: HH:MM" and warn the user when the pipeline hasn't run
-- in > 36h (honest "0 signals = calm state" requires this). Agent's
-- recommendation: without this, the inbox-is-empty message lies when
-- the cron silently fails.
CREATE TABLE IF NOT EXISTS cron_runs (
  id SERIAL PRIMARY KEY,
  job VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  -- Counts populated on success: how many tickers processed, how many
  -- filings scanned, how many rows inserted, how many errors per ticker.
  processed_tickers INTEGER,
  inserted_signals INTEGER,
  error_count INTEGER,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS cron_runs_job_idx ON cron_runs(job, started_at DESC);

-- Moatboard's verdict on the business (one row per position, overwritten on regeneration)
CREATE TABLE IF NOT EXISTS moatboard_analyses (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  tier VARCHAR(20) NOT NULL CHECK (tier IN ('exceptional', 'good', 'mediocre', 'poor')),
  verdict_reason TEXT NOT NULL,
  scorecard_summary JSONB NOT NULL,
  moat_strength VARCHAR(10) NOT NULL,
  moat_archetype VARCHAR(30) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Valuation: intrinsic value estimate and margin of safety per position.
-- DCF produces a range (low/base/high) from three hurdle rates. The primary
-- `intrinsic_value` is the base (12% hurdle). For AI multiples fallback,
-- low == base == high.
--
-- `tier` is the compound tier — DCF + relative-to-self combined (drift M).
-- `dcf_tier` holds the DCF-only classification for transparency / expand-on-demand.
-- `relative_tier` holds the relative-to-self classification; NULL when there
-- isn't enough history to compute one.
-- Relative distribution stats (median/Q1/Q3/max/current percentile for PE and
-- FCF yield) live inside `assumptions` JSONB.
CREATE TABLE IF NOT EXISTS valuations (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL CHECK (method IN ('implied_return', 'dcf', 'affo_dcf', 'excess_returns', 'ai_multiples')),
  intrinsic_value NUMERIC(14, 4) NOT NULL,
  intrinsic_value_low NUMERIC(14, 4) NOT NULL,
  intrinsic_value_high NUMERIC(14, 4) NOT NULL,
  current_price NUMERIC(14, 4) NOT NULL,
  margin_of_safety_pct NUMERIC(7, 2) NOT NULL,
  tier VARCHAR(30) NOT NULL CHECK (tier IN (
    'rare_opportunity', 'within_historical', 'above_historical',
    'stratospheric', 'dcf_only'
  )),
  dcf_tier VARCHAR(20) NOT NULL CHECK (dcf_tier IN ('margin', 'acceptable', 'fair', 'premium')),
  relative_tier VARCHAR(20) CHECK (relative_tier IS NULL OR relative_tier IN (
    'rare', 'within', 'above', 'stratospheric'
  )),
  assumptions JSONB NOT NULL,
  reasoning TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User's thesis (one row per position; either user-written free-form or AI-generated structured).
-- `pre_commitment_md` is the user's own answer to "what would make me change my mind about owning this?".
-- It's set at decision time (invest / watchlist) and persists across the life of the position. Individual
-- transactions have their own `pre_commitment_md` (per-buy context); this one is the enduring thesis-level
-- commitment that anchors behavior when price moves.
CREATE TABLE IF NOT EXISTS theses (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  source VARCHAR(10) NOT NULL CHECK (source IN ('user', 'ai')),
  raw_text TEXT NOT NULL,
  structured_content JSONB,
  pre_commitment_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

ALTER TABLE theses ADD COLUMN IF NOT EXISTS pre_commitment_md TEXT;

CREATE TABLE IF NOT EXISTS monthly_reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary JSONB,
  UNIQUE (user_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_monthly_reviews_user_id ON monthly_reviews(user_id);

-- SEC EDGAR integration (2026-04-18)
-- Ticker → CIK mapping from sec.gov/files/company_tickers.json.
-- Refreshed weekly. CIK stored zero-padded to 10 digits (URL-ready).
CREATE TABLE IF NOT EXISTS sec_ticker_cik (
  ticker TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  title TEXT,
  last_refreshed TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw + parsed SEC XBRL fundamentals per ticker. Shared across users
-- (SEC data is user-agnostic). TTL 24h for hot tickers, 7d for others;
-- enforced at read time via last_fetched timestamp.
--
-- raw_facts holds the unmodified companyfacts payload so we can re-parse
-- with an updated mapping rule without re-hitting SEC.
-- parsed_annual is the 10-K / 20-F annual history (10-18 years typical).
-- parsed_quarterly (added 2026-04-19) is the 10-Q trail needed to detect new
-- quarterly filings and drive automatic quarterly snapshots of fundamentals.
-- parse_notes traces which tag each field came from (debug aid).
CREATE TABLE IF NOT EXISTS sec_fundamentals_cache (
  ticker TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  entity_name TEXT,
  last_fetched TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('ok', 'no_cik', 'fetch_error', 'parse_error')),
  raw_facts JSONB,
  parsed_annual JSONB,
  parsed_quarterly JSONB,
  years_available INT,
  quarters_available INT,
  earliest_year INT,
  latest_year INT,
  latest_quarter_accession TEXT,
  latest_quarter_period_end DATE,
  latest_quarter_form TEXT,
  latest_quarter_filed DATE,
  parse_notes JSONB
);

CREATE INDEX IF NOT EXISTS idx_sec_fundamentals_cik ON sec_fundamentals_cache(cik);

-- Backfill columns on existing DBs.
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS parsed_quarterly JSONB;
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS quarters_available INT;
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS latest_quarter_accession TEXT;
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS latest_quarter_period_end DATE;
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS latest_quarter_form TEXT;
ALTER TABLE sec_fundamentals_cache ADD COLUMN IF NOT EXISTS latest_quarter_filed DATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Analysis flow redesign (Phase 1, 2026-04-19)
--
-- The original UI was "add ticker → auto-analyze everything → render three
-- sections on one page". The redesign turns the analysis into a stepped flow:
--   quality → understanding → red_flags → valuation → decision
-- Quality runs first so the scorecard tier can short-circuit further AI
-- spend — if the business fails the tier bar, the user discards at step 1
-- without spending Claude tokens on Understanding + Red flags (both of
-- which read the full 10-K). Three final outcomes (invest / watchlist /
-- discarded) plus an exit ramp at the understanding step (outside_circle).
-- Every step persists state so the user can resume a session and never
-- re-analyzes a ticker blindly.
--
-- At the moment of deciding "invest" (or adding to an existing position) the
-- system stores an immutable snapshot of the quality scorecard + valuation +
-- thesis. Automatic quarterly snapshots fire when a new 10-Q/10-K is detected.
-- Together these form the trajectory that makes monthly review possible and
-- that anchors decisions to the state of the business, not to price moves.
-- ─────────────────────────────────────────────────────────────────────────────

-- Business understanding: plain-language explanation of what the company does,
-- how it makes money, who pays, how it reinvests, etc. Generated by Claude
-- from the 10-K (Item 1: Business) + the latest earnings call. Each ticker
-- accumulates versions over time; regeneration archives the previous version
-- and creates a new row (version = old_version + 1). The "current" version
-- is simply the row with the highest version for that ticker.
--
-- Per-ticker, shared across users (the nature of a business does not depend
-- on the user looking at it). `questions_and_answers` stores the 5-7 AI-
-- pregenerated Q&A plus any user follow-up answers kept for later review.
-- `sources` is an array of {url, label, type: '10k'|'10q'|'earnings_call'|'other'}.
CREATE TABLE IF NOT EXISTS business_understanding (
  ticker VARCHAR(10) NOT NULL,
  version INTEGER NOT NULL,
  summary_md TEXT NOT NULL,
  questions_and_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_with_model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6',
  archived_at TIMESTAMPTZ,
  last_10k_accession TEXT,
  last_10k_period_end DATE,
  PRIMARY KEY (ticker, version)
);

-- Backfill on existing DBs that predate the 10-K grounding columns.
ALTER TABLE business_understanding
  ADD COLUMN IF NOT EXISTS last_10k_accession TEXT;
ALTER TABLE business_understanding
  ADD COLUMN IF NOT EXISTS last_10k_period_end DATE;

CREATE INDEX IF NOT EXISTS idx_business_understanding_ticker_version
  ON business_understanding(ticker, version DESC);

-- Qualitative red flags extracted from the latest 10-K: changes of auditor,
-- CEO/CFO turnover, material litigation, restructuring, going-concern doubts.
-- Per-ticker, shared across users, single row (latest 10-K only).
-- `last_10k_accession` is the SEC accession number of the 10-K the flags
-- were extracted from. When a new 10-K is detected we regenerate.
CREATE TABLE IF NOT EXISTS qualitative_red_flags (
  ticker VARCHAR(10) PRIMARY KEY,
  flags JSONB NOT NULL,
  last_10k_accession TEXT,
  last_10k_period_end DATE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_with_model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6'
);

-- Ticker state, per-user: where does this ticker sit in the user's workflow?
-- Status values:
--   · 'in_portfolio'    — user owns at least one share (has a positions row + buy transaction)
--   · 'watchlist'       — user wants to revisit later; `review_when` captures the trigger
--   · 'discarded'       — user looked at it and decided against investing; `reason_md` explains why
--   · 'outside_circle'  — user admitted they don't understand the business well enough to evaluate
--                         (exit ramp at the understanding step); `reason_md` captures the gap
--
-- When a ticker is re-introduced to the analysis flow, an existing row here
-- surfaces context ("you analyzed this on 2026-03-10 and discarded because X")
-- so the user doesn't re-analyze blindly.
CREATE TABLE IF NOT EXISTS ticker_states (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'in_portfolio', 'watchlist', 'discarded', 'outside_circle'
  )),
  reason_md TEXT,
  review_when TEXT,
  -- When a ticker that was previously discarded / on watchlist / outside
  -- circle gets bought, the prior reason_md is preserved here so the position
  -- page can surface "you had discarded this on YYYY-MM-DD because X before
  -- changing your mind". Otherwise NULL.
  prior_reason_on_invest_md TEXT,
  last_touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_ticker_states_user_id ON ticker_states(user_id);
CREATE INDEX IF NOT EXISTS idx_ticker_states_user_status ON ticker_states(user_id, status);

-- Backfill on existing DBs (additive — no migration risk).
ALTER TABLE ticker_states ADD COLUMN IF NOT EXISTS prior_reason_on_invest_md TEXT;

-- Analysis session: persisted state of a walk through the stepped flow so the
-- user can resume. At most one active session per (user, ticker) — enforced
-- by the partial unique index below. When the session completes, `completed_at`
-- and `outcome` are populated; the row stays for history.
-- `current_step` is where the user is viewing now. `furthest_step` is the
-- deepest step they've reached — needed because the step indicator lets the
-- user click back to review prior steps without losing access to the ones
-- they'd already completed further down the line.
CREATE TABLE IF NOT EXISTS analysis_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  current_step VARCHAR(20) NOT NULL CHECK (current_step IN (
    'understanding', 'red_flags', 'quality', 'valuation',
    'decision', 'completed'
  )),
  furthest_step VARCHAR(20) NOT NULL DEFAULT 'quality' CHECK (furthest_step IN (
    'understanding', 'red_flags', 'quality', 'valuation',
    'decision', 'completed'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  outcome VARCHAR(20) CHECK (outcome IS NULL OR outcome IN (
    'invested', 'watchlist', 'discarded', 'outside_circle', 'abandoned'
  )),
  business_understanding_version INTEGER,
  understood_flag VARCHAR(15) CHECK (understood_flag IS NULL OR understood_flag IN (
    'understood', 'doubts_resolved', 'not_understood'
  ))
);

-- Backfill on existing DBs.
ALTER TABLE analysis_sessions ADD COLUMN IF NOT EXISTS furthest_step VARCHAR(20)
  NOT NULL DEFAULT 'understanding';

CREATE INDEX IF NOT EXISTS idx_analysis_sessions_user_ticker
  ON analysis_sessions(user_id, ticker);

-- Only one active session per (user, ticker) — completed sessions are free to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_analysis_session
  ON analysis_sessions(user_id, ticker)
  WHERE completed_at IS NULL;

-- Position transactions: log of every buy / add / trim / sell on a position.
-- Replaces the single purchase_price + purchase_date that used to live on the
-- positions row. Cost basis and current shares are derived by aggregating this
-- log (at most ~dozens of rows per ticker, trivial to sum). `pre_commitment_md`
-- captures the "what would make me change my mind" at the moment of the
-- specific transaction — separate from the enduring thesis-level commitment
-- (which lives on theses.pre_commitment_md).
CREATE TABLE IF NOT EXISTS position_transactions (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('buy', 'add', 'trim', 'sell')),
  transaction_date DATE NOT NULL,
  price NUMERIC(14, 4) NOT NULL,
  shares NUMERIC(16, 6) NOT NULL,
  pre_commitment_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_position_transactions_position_id
  ON position_transactions(position_id);
CREATE INDEX IF NOT EXISTS idx_position_transactions_date
  ON position_transactions(position_id, transaction_date);

-- Fundamentals snapshots: immutable frozen frames of quality + valuation for a
-- specific (user, ticker) at a specific moment. Per-user because each snapshot
-- binds to a transaction (purchase price, thesis in force) or to a user's
-- position. Snapshots are never updated — if a calculation bug is fixed later,
-- old snapshots keep reflecting what the user saw at the time of decision.
--
-- `trigger` distinguishes:
--   · 'transaction'    — fired by a buy/add/trim/sell (transaction_id set)
--   · 'quarterly_10q'  — fired by the detection of a new 10-Q filing
--   · 'annual_10k'     — fired by the detection of a new 10-K filing
--
-- For 'transaction' snapshots, `sec_filing_accession` is NULL (they're anchored
-- to the transaction, not a filing). For quarterly/annual, it's the SEC
-- accession number of the filing that triggered it. The partial unique index
-- below prevents generating the same quarterly snapshot twice for the same
-- filing — NULL accessions are not enforced by this constraint, which is what
-- we want (transactions can coexist freely).
--
-- Most scorecard/valuation inputs are persisted as JSONB for flexibility:
-- scoring thresholds may evolve over time, but the snapshot should keep the
-- numbers as they were scored on that day.
CREATE TABLE IF NOT EXISTS fundamentals_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES position_transactions(id) ON DELETE SET NULL,
  trigger VARCHAR(20) NOT NULL CHECK (trigger IN (
    'transaction', 'quarterly_10q', 'annual_10k'
  )),
  sec_filing_accession TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_price NUMERIC(14, 4),
  -- Quality snapshot
  tier VARCHAR(20) CHECK (tier IS NULL OR tier IN (
    'exceptional', 'good', 'mediocre', 'poor'
  )),
  scorecard_summary JSONB NOT NULL,
  multi_year JSONB,
  moat JSONB,
  -- Valuation snapshot (structure mirrors the `valuations` table but frozen)
  valuation_method VARCHAR(20) CHECK (valuation_method IS NULL OR valuation_method IN (
    'dcf', 'affo_dcf', 'excess_returns', 'ai_multiples'
  )),
  valuation_intrinsic_value NUMERIC(14, 4),
  valuation_intrinsic_value_low NUMERIC(14, 4),
  valuation_intrinsic_value_high NUMERIC(14, 4),
  valuation_margin_of_safety_pct NUMERIC(7, 2),
  valuation_assumptions JSONB,
  valuation_guide JSONB,
  -- Understanding + thesis context (only populated for transaction snapshots at buy time)
  business_understanding_version INTEGER,
  thesis_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_snapshots_user_ticker
  ON fundamentals_snapshots(user_id, ticker, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_fundamentals_snapshots_position
  ON fundamentals_snapshots(position_id, taken_at DESC);

-- Prevent duplicating the same quarterly/annual snapshot for the same filing.
-- Partial index: only enforces when sec_filing_accession is not NULL, so
-- transaction snapshots (which always have NULL accession) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_filing_snapshot
  ON fundamentals_snapshots(user_id, ticker, sec_filing_accession)
  WHERE sec_filing_accession IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Discovery (Phase 7): roster of curated world-class funds, their
-- quarterly 13F-HR filings, and the per-holding rows. Drives the
-- consensus-conviction leaderboard feeding the wizard.
-- ─────────────────────────────────────────────────────────────────────────

-- 32 curated funds (seeded). Tier weights drive the conviction score
-- so quality-aligned managers (tier A) outweigh growth hedges (tier E)
-- in the leaderboard, preventing mega-cap-bias dominance.
CREATE TABLE IF NOT EXISTS discovery_funds (
  id SERIAL PRIMARY KEY,
  cik VARCHAR(10) NOT NULL UNIQUE,
  manager_name VARCHAR(160) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  tier VARCHAR(1) NOT NULL CHECK (tier IN ('A','B','C','D','E')),
  tier_weight NUMERIC(3, 1) NOT NULL,
  philosophy VARCHAR(400),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_funds_active_tier
  ON discovery_funds(active, tier);

-- One row per quarterly 13F-HR filing successfully parsed. Idempotent
-- via UNIQUE (fund_id, accession).
CREATE TABLE IF NOT EXISTS discovery_filings (
  id SERIAL PRIMARY KEY,
  fund_id INTEGER NOT NULL REFERENCES discovery_funds(id) ON DELETE CASCADE,
  accession VARCHAR(25) NOT NULL,
  period_of_report DATE NOT NULL,
  filing_date DATE NOT NULL,
  total_value_usd NUMERIC(20, 2),
  holdings_count INTEGER,
  source_url TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fund_id, accession)
);

CREATE INDEX IF NOT EXISTS idx_discovery_filings_fund_period
  ON discovery_filings(fund_id, period_of_report DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_filings_period
  ON discovery_filings(period_of_report DESC);

-- Per-holding per-filing rows. ticker nullable for CUSIPs we can't
-- resolve (delisted, private, non-US). weight_in_fund is 0-100.
CREATE TABLE IF NOT EXISTS discovery_holdings (
  id SERIAL PRIMARY KEY,
  filing_id INTEGER NOT NULL REFERENCES discovery_filings(id) ON DELETE CASCADE,
  cusip VARCHAR(9) NOT NULL,
  ticker VARCHAR(10),
  issuer_name VARCHAR(200) NOT NULL,
  class_title VARCHAR(40),
  shares BIGINT NOT NULL,
  value_usd NUMERIC(20, 2) NOT NULL,
  weight_in_fund NUMERIC(7, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_holdings_filing
  ON discovery_holdings(filing_id);
CREATE INDEX IF NOT EXISTS idx_discovery_holdings_ticker
  ON discovery_holdings(ticker);
CREATE INDEX IF NOT EXISTS idx_discovery_holdings_cusip
  ON discovery_holdings(cusip);

-- Discovery pre-analysis: agentic Quality + Moat + Red flags pre-tiering
-- across the Discovery roster. Populated by runDiscoveryPreAnalysisJob;
-- consumed by the Discovery leaderboard (tier chip + serious-flags badge)
-- and by the future "what changed materially this week?" inbox.
--
-- One row per ticker (ticker as PK because pre-analysis is global, not
-- per-user — same pattern as moat_assessments / valuation_guides).
-- Tickers that don't pass coverage gates (SEC <5y, fewer than 2 funds,
-- <5 applicable scorecard dimensions) get a row with status='not_covered'
-- so we don't re-attempt them on every cron run.
CREATE TABLE IF NOT EXISTS discovery_pre_analyses (
  ticker VARCHAR(10) PRIMARY KEY,
  status VARCHAR(20) NOT NULL CHECK (
    status IN ('covered', 'not_covered', 'pending', 'error')
  ),
  -- Quality outputs (populated only when status='covered').
  -- The tier is an OPINION derived from the scorecard_summary +
  -- moat_strength + moat_archetype according to the rules of
  -- `tier_preset`. The data layer (scorecard_summary, moat fields)
  -- is OBJECTIVE. Separating them lets future presets ('akre_quality',
  -- 'smith_growth', etc.) recompute tier on read without re-running
  -- the expensive 10-K + AI pipeline. v1 ships with one preset only.
  tier_preset VARCHAR(40) NOT NULL DEFAULT 'moatboard_default',
  tier VARCHAR(15) CHECK (
    tier IS NULL OR tier IN ('exceptional', 'good', 'mediocre', 'poor')
  ),
  applicable_dimensions INT,
  scorecard_summary JSONB,
  moat_strength VARCHAR(10) CHECK (
    moat_strength IS NULL OR moat_strength IN ('strong', 'weak', 'unclear')
  ),
  moat_archetype VARCHAR(30) CHECK (
    moat_archetype IS NULL OR moat_archetype IN (
      'brand', 'network_effects', 'switching_costs', 'scale',
      'ip', 'regulatory', 'cost_advantage', 'none'
    )
  ),
  -- Red flags pre-processing (decision: included in v1 because tier
  -- without flags can mislead — going-concern can flip Exceptional to
  -- "do not enter" instantly).
  has_serious_red_flags BOOLEAN NOT NULL DEFAULT FALSE,
  serious_red_flags_count INT NOT NULL DEFAULT 0,
  watch_red_flags_count INT NOT NULL DEFAULT 0,
  -- 10-K accession the pre-analysis was evaluated against. Staleness:
  -- when SEC publishes a newer 10-K (delta detected by the daily signals
  -- cron extension), the row is invalidated and re-run.
  last_10k_accession VARCHAR(30),
  last_10k_period_end DATE,
  -- Reason for not_covered (e.g. "SEC <5y of fundamentals",
  -- "below 2-fund threshold", "<5 applicable scorecard dimensions").
  not_covered_reason VARCHAR(200),
  -- Last-attempt error message when status='error'.
  error_message VARCHAR(500),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_with_model VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_discovery_pre_analyses_tier
  ON discovery_pre_analyses(status, tier);
CREATE INDEX IF NOT EXISTS idx_discovery_pre_analyses_serious
  ON discovery_pre_analyses(has_serious_red_flags)
  WHERE status = 'covered';

-- CUSIP → ticker cache. Permanent once resolved. ticker nullable when
-- OpenFIGI can't map (private companies, foreign securities). Source
-- tracks where the resolution came from for manual audits.
CREATE TABLE IF NOT EXISTS discovery_cusip_ticker (
  cusip VARCHAR(9) PRIMARY KEY,
  ticker VARCHAR(10),
  issuer_name VARCHAR(200),
  exchange_code VARCHAR(10),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(30) NOT NULL DEFAULT 'openfigi'
);

-- Per-ticker log of insider (Section 16) transactions parsed from Form
-- 4 XML filings. Shared across users because Form 4 is public data;
-- review_signals rows generated from this table are per-user.
-- Idempotency at (accession, transaction_index) since a single Form 4
-- can carry multiple transactions (same insider, same day, split
-- executions). transaction_value_usd is generated for fast filtering.
CREATE TABLE IF NOT EXISTS insider_transactions (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  issuer_cik VARCHAR(10) NOT NULL,
  accession VARCHAR(25) NOT NULL,
  filing_date DATE NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_index INT NOT NULL,
  reporting_owner_cik VARCHAR(10) NOT NULL,
  reporting_owner_name VARCHAR(200) NOT NULL,
  reporting_owner_title VARCHAR(200),
  is_officer BOOLEAN NOT NULL DEFAULT FALSE,
  is_director BOOLEAN NOT NULL DEFAULT FALSE,
  is_ten_percent_owner BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_code CHAR(1) NOT NULL,
  acquired_disposed CHAR(1) NOT NULL,
  shares NUMERIC(20,4) NOT NULL,
  price_per_share NUMERIC(14,4) NOT NULL,
  transaction_value_usd NUMERIC(18,2) GENERATED ALWAYS AS (shares * price_per_share) STORED,
  rule10b5_1_flag BOOLEAN,
  direct_or_indirect CHAR(1) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (accession, transaction_index)
);

CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker_date
  ON insider_transactions(ticker, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_insider_tx_code
  ON insider_transactions(ticker, transaction_code, transaction_date DESC);

-- Per-user acknowledgement of new 13F filings shown in the Discovery
-- "Novedades" panel. A row here means the user has explicitly marked
-- a filing as "seen" from the panel; the panel then hides it on
-- subsequent visits. Deliberately permanent (no TTL) — the user
-- controls when something leaves the panel, not the calendar.
CREATE TABLE IF NOT EXISTS discovery_filing_dismissals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filing_id INTEGER NOT NULL REFERENCES discovery_filings(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, filing_id)
);

CREATE INDEX IF NOT EXISTS idx_dfd_user_dismissed
  ON discovery_filing_dismissals(user_id, dismissed_at DESC);

-- Maps share-class duplicates (GOOG/GOOGL, BRK-B/BRK-A) to a single
-- canonical ticker so Discovery aggregates conviction by business and
-- per-ticker IA caches dedupe across share classes. The canonical maps
-- to itself implicitly: if no row exists for a ticker, it's its own
-- canonical (consumer code uses COALESCE(canonical_ticker, ticker)).
-- Hard rule (CHECK): never INSERT a row where ticker = canonical, so the
-- canonical is always identifiable by the absence of a row keyed on it.
CREATE TABLE IF NOT EXISTS ticker_aliases (
  ticker VARCHAR(10) PRIMARY KEY,
  canonical_ticker VARCHAR(10) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_alias_not_self CHECK (ticker <> canonical_ticker)
);

CREATE INDEX IF NOT EXISTS idx_ticker_aliases_canonical
  ON ticker_aliases(canonical_ticker);

-- Per-ticker valuation chat history. Stores Joseda's questions to the
-- AI about a ticker's valuation and the AI's answers. Durable per
-- (user_id, ticker): survives regeneration of the underlying valuations
-- row. Each turn carries a JSONB snapshot of the valuation context at
-- the moment of asking, so the UI can render "version dividers" when
-- the math has been regenerated since (preserves coherence between the
-- turn's text and the data it referenced).
CREATE TABLE IF NOT EXISTS valuation_chats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_with_model VARCHAR(50) NOT NULL,
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_valuation_chats_user_ticker
  ON valuation_chats(user_id, ticker, asked_at);
