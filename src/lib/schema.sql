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
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker VARCHAR(10) NOT NULL,
  purchase_price NUMERIC(12, 4) NOT NULL,
  purchase_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);

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
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_with_model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6'
);

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
  method VARCHAR(20) NOT NULL CHECK (method IN ('dcf', 'affo_dcf', 'excess_returns', 'ai_multiples')),
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

-- User's thesis (one row per position; either user-written free-form or AI-generated structured)
CREATE TABLE IF NOT EXISTS theses (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  source VARCHAR(10) NOT NULL CHECK (source IN ('user', 'ai')),
  raw_text TEXT NOT NULL,
  structured_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

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
-- parsed_annual will be populated in Session 2 (parser); left nullable here.
-- parse_notes traces which tag each field came from (debug aid).
CREATE TABLE IF NOT EXISTS sec_fundamentals_cache (
  ticker TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  entity_name TEXT,
  last_fetched TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('ok', 'no_cik', 'fetch_error', 'parse_error')),
  raw_facts JSONB,
  parsed_annual JSONB,
  years_available INT,
  earliest_year INT,
  latest_year INT,
  parse_notes JSONB
);

CREATE INDEX IF NOT EXISTS idx_sec_fundamentals_cik ON sec_fundamentals_cache(cik);
