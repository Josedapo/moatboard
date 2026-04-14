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
│   ├── about/page.tsx                 # Methodology (placeholder)
│   ├── pricing/page.tsx               # Free vs Pro
│   ├── auth/signin/page.tsx           # Google sign-in
│   ├── api/auth/[...nextauth]/route.ts # NextAuth handlers (runtime: nodejs)
│   └── dashboard/
│       ├── page.tsx                   # Portfolio list with current prices + change %
│       ├── actions.ts                 # addPositionAction, deletePositionAction
│       └── position/[id]/
│           ├── page.tsx               # Position detail (auto-runs analysis + valuation)
│           └── actions.ts             # runAnalysisAction, runValuationAction, thesis actions, etc.
├── components/                        # All UI components (mix of Server + Client)
├── lib/                               # Domain logic, DB, AI, pure functions
│   ├── db.ts                          # Neon serverless client
│   ├── schema.sql                     # Source of truth for DB schema
│   ├── financial.ts                   # yahoo-finance2 wrapper (Quote, Fundamentals types)
│   ├── scorecard.ts                   # Per-metric quality scoring (pure)
│   ├── verdict.ts                     # Formulaic tier computation + reason templates (pure)
│   ├── moats.ts                       # CRUD for moat_assessments
│   ├── moatAi.ts                      # AI moat assessment (lazy client)
│   ├── verdictAi.ts                   # AI prose composition for verdict_reason
│   ├── analysis.ts                    # Orchestrator: runAnalysis() ties scorecard + moat + tier + prose
│   ├── moatboardAnalyses.ts           # CRUD for moatboard_analyses
│   ├── valuation.ts                   # Pure DCF + Margin of Safety classifier
│   ├── valuationAi.ts                 # AI DCF assumptions + multiples fallback
│   ├── valuations.ts                  # CRUD for valuations
│   ├── positionFlow.ts                # ensureAnalysis / ensureValuation (get-or-create)
│   ├── thesis.ts                      # AI thesis generation (5 structured fields, gated by tier)
│   ├── theses.ts                      # CRUD for theses (user vs ai source)
│   └── positions.ts                   # CRUD for positions
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
- `positions` — user portfolio entries (ticker, purchase_price, purchase_date)
- `moat_assessments` — **per-ticker, shared across users**, AI-evaluated, TTL 365 days
- `moatboard_analyses` — per-position verdict (tier, verdict_reason, scorecard_summary, moat snapshot)
- `valuations` — per-position MoS (method, intrinsic_value, current_price, tier, assumptions, reasoning)
- `theses` — per-position user thesis (source: 'user' | 'ai', raw_text, structured_content JSONB)
- `monthly_reviews` — placeholder for future Phase 1 monthly review feature

## Architectural Patterns

### "Ensure" pattern (auto-run on first render)

`src/lib/positionFlow.ts` exposes `ensureAnalysis()` and `ensureValuation()`. The position detail page calls them in `Promise.all`. If the row exists in DB → return it (instant). If not → compute it via the orchestrator + save → return it. This eliminates "Run" buttons; data appears automatically.

### Quality verdict pipeline (formulaic + minimal AI)

```
fundamentals (yfinance, free/fast)
  → scorecard.ts: scoreMetric() per dimension
  → moats.ts: cached moat for ticker
    └─ if missing/stale → moatAi.ts: assessMoat() → save + return
  → verdict.ts: computeQualityTier() (pure, deterministic)
  → verdictAi.ts: composeVerdictNarrative() (one short Claude call for prose)
    └─ on failure → verdict.ts: renderVerdictReason() (deterministic fallback)
  → save to moatboard_analyses
```

The tier itself is **never** AI-driven — only the prose. Reason: reproducibility, cost, and the philosophical principle that the verdict is a measurable judgment.

### Valuation pipeline

```
quote + fundamentals (yfinance)
  → if FCF > 0 AND sharesOutstanding > 0 → DCF path
      → valuationAi.ts: suggestDcfAssumptions() (1 Claude call)
      → valuation.ts: computeDcfIntrinsicValue() (pure)
  → else → AI multiples fallback
      → valuationAi.ts: estimateWithMultiples() (1 Claude call)
  → valuation.ts: classifyMarginOfSafety() (pure, IV/Price ratio + tier)
  → save to valuations
```

User-edited assumptions (`updateValuationAssumptionsAction`) go through pure recompute only — **no AI re-call**.

### Cache philosophy

- **Per-ticker, shared across users:** `moat_assessments`. Refreshed yearly via TTL. Future Quality Universe (next session) will batch-populate this.
- **Per-position, per-user:** `moatboard_analyses`, `valuations`, `theses`. Overwritten on regenerate.
- **Always fresh:** fundamentals from yfinance (no cache — fast and free enough).

### Margin of Safety formula

```
IV/Price ratio = IntrinsicValue / CurrentPrice
MoS%           = (IV/Price - 1) × 100
```

Both are recomputed on display (in `Valuation.tsx` and `page.tsx`) from the stored `intrinsic_value` and `current_price` so legacy rows or formula changes always render correctly. Tier thresholds: ≥1.20x = Margin of Safety (emerald), 0.85-1.20x = Fair Price (blue), 0.65-0.85x = Premium (amber), <0.65x = Overvalued (red). **Note:** the philosophy review (`../Context/buffett-munger-philosophy-review.md`) flags these thresholds as too lenient vs real Buffett standards (he wanted 33-50%+).

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

- `Tier = 'exceptional' | 'good' | 'average' | 'poor'` exported from `lib/verdict.ts`
- `MosTier = 'margin' | 'fair' | 'premium' | 'overvalued'` exported from `lib/valuation.ts`
- `MoatStrength`, `MoatArchetype` exported from `lib/verdict.ts`
- `ThesisContent`, `ThesisField` exported from `lib/thesis.ts`
- Database row types use snake_case field names (matching Postgres columns); business logic types use camelCase

### Tailwind palette

Custom navy scale defined in `src/app/globals.css` (`--color-navy-50` through `--color-navy-950`). Use `text-navy-900`, `bg-navy-50`, etc. — not arbitrary hex codes.

Tier color vocabulary (kept consistent across QualityBadge, MarginOfSafetyBadge, verdict box, scorecard cards):
- emerald = strong / margin / exceptional
- teal = good
- blue = fair price (only used in valuation)
- amber = acceptable / mixed / premium / average
- red = weak / overvalued / poor

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
```

## Sanity-check Tickers

When testing the verdict + valuation pipeline:
- **AAPL** — should be Exceptional or Good with strong moat (brand/switching_costs); valuation likely Premium or Overvalued at current prices
- **CVNA** — should be Poor (high debt, history of negative FCF)
- **GME** — should be Poor (no moat, weak fundamentals)
- A growth pre-profit ticker (e.g., a recent IPO) — Valuation should fall back to AI multiples, not DCF

## Important Rules

- **Do not change scorecard / verdict / valuation logic without first re-reading `../Context/buffett-munger-philosophy-review.md`.** That document defines the philosophical north star and lists 12 specific drifts the product needs to evolve toward closing.
- All pages and copy in English (the SEO universe is 100% English).
- Calm, deliberate UX. Every change passes the anti-trading test: "does this incentivize trading or compulsive checking?" If yes, discard.
- Fundamentals are always fetched fresh from yfinance — never cached.
- Moat assessments are cached per ticker, shared across users (not per-position).
- AI is used for: moat strength + archetype, verdict prose, DCF assumptions, multiples fallback, AI thesis generation. Everything else is deterministic.
