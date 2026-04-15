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
CREATE TABLE IF NOT EXISTS valuations (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL CHECK (method IN ('dcf', 'ai_multiples')),
  intrinsic_value NUMERIC(14, 4) NOT NULL,
  intrinsic_value_low NUMERIC(14, 4) NOT NULL,
  intrinsic_value_high NUMERIC(14, 4) NOT NULL,
  current_price NUMERIC(14, 4) NOT NULL,
  margin_of_safety_pct NUMERIC(7, 2) NOT NULL,
  tier VARCHAR(20) NOT NULL CHECK (tier IN ('margin', 'acceptable', 'fair', 'premium')),
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
