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
│       ├── page.tsx                   # Portfolio list with current prices + change %
│       ├── actions.ts                 # addPositionAction, deletePositionAction
│       └── position/[id]/
│           ├── page.tsx               # Position detail (auto-runs analysis + valuation)
│           └── actions.ts             # runAnalysisAction, runValuationAction, thesis actions, etc.
├── components/                        # All UI components (mix of Server + Client)
├── lib/                               # Domain logic, DB, AI, pure functions
│   ├── db.ts                          # Neon serverless client
│   ├── schema.sql                     # Source of truth for DB schema
│   ├── financial.ts                   # yahoo-finance2 wrapper (Quote, Fundamentals, RelativeValuationPoint)
│   ├── scorecard.ts                   # Per-metric quality scoring (pure) + business-type helpers (isBalanceSheetBusiness, isRealEstate, isCommodityCyclical) + multi-year scorers (median + worst-year)
│   ├── verdict.ts                     # Formulaic tier computation + reason templates (pure)
│   ├── moats.ts                       # CRUD for moat_assessments
│   ├── moatAi.ts                      # AI moat assessment (lazy client)
│   ├── verdictAi.ts                   # AI prose composition for verdict_reason
│   ├── analysis.ts                    # Orchestrator: runAnalysis() ties scorecard + moat + tier + prose
│   ├── moatboardAnalyses.ts           # CRUD for moatboard_analyses
│   ├── valuation.ts                   # Pure DCF (two-stage owner earnings) + tier types
│   ├── valuationAi.ts                 # AI multiples fallback only (DCF inputs are deterministic)
│   ├── valuations.ts                  # CRUD for valuations; RelativeValuationSnapshot type
│   ├── relativeValuation.ts           # Pure distribution stats (median/Q1/Q3/IQR) and classifier
│   ├── valuationGuideAi.ts            # AI valuation guide — which tools matter most for this business
│   ├── valuationGuides.ts             # CRUD for valuation_guides (per-ticker cache, TTL 365d)
│   ├── positionFlow.ts                # ensureAnalysis / ensureValuation / computeRelativeValuationContext
│   ├── tooHard.ts                     # Sector/industry too-hard gate (Buffett circle-of-competence)
│   ├── thesis.ts                      # AI thesis generation (6 structured fields, gated by tier)
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
- `valuation_guides` — **per-ticker, shared across users**, AI-generated advice on which valuation tools matter most for a business type (primary/secondary/cautious + reasoning), TTL 365 days
- `moatboard_analyses` — per-position verdict (tier, verdict_reason, scorecard_summary, moat snapshot)
- `valuations` — per-position IV + MoS (method, intrinsic_value range, current_price, dcf_tier, relative_tier, compound tier, assumptions JSONB including RelativeValuationSnapshot). `method` CHECK constraint allows `'dcf' | 'affo_dcf' | 'excess_returns' | 'ai_multiples'`. Note: the compound `tier`, `dcf_tier` and `relative_tier` columns are legacy — still persisted but no longer read by the UI (see philosophy-review drift M correction, 2026-04-16). The per-method `assumptions` shape differs (owner-earnings DCF, AFFO DCF, Excess Returns, AI multiples)
- `theses` — per-position user thesis (source: 'user' | 'ai', raw_text, structured_content JSONB)
- `monthly_reviews` — placeholder for future Phase 1 monthly review feature

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

## Important Rules

- **Do not change scorecard / verdict / valuation logic without first re-reading `../Context/buffett-munger-philosophy-review.md`.** That document defines the philosophical north star and lists 12 specific drifts the product needs to evolve toward closing.
- All pages and copy in English (the SEO universe is 100% English).
- Calm, deliberate UX. Every change passes the anti-trading test: "does this incentivize trading or compulsive checking?" If yes, discard.
- Fundamentals are always fetched fresh from yfinance — never cached.
- Moat assessments are cached per ticker, shared across users (not per-position).
- AI is used for: moat strength + archetype, verdict prose, DCF assumptions, multiples fallback, AI thesis generation. Everything else is deterministic.
