# Moatboard App - Development Instructions

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **CSS:** Tailwind CSS v4
- **Hosting:** Vercel (auto-deploy from GitHub)
- **Database:** Vercel Postgres (Neon) via @neondatabase/serverless
- **Auth:** NextAuth.js (Auth.js v5) — Google OAuth + magic link
- **AI:** Claude API (Anthropic SDK) for thesis generation
- **Financial data:** yfinance (via API route)
- **Analytics:** GA4

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Homepage / landing
│   ├── about/page.tsx        # Methodology
│   ├── pricing/page.tsx      # Free vs Pro
│   ├── dashboard/            # Auth-protected area
│   └── api/                  # API routes
├── components/               # React components
└── lib/                      # Utilities and business logic
```

## Design System

- **Primary color:** Navy (#1e3a5f) — trust, finance
- **Accent:** Emerald (#059669) — quality, growth
- **Warning:** Amber (#d97706) — thesis alerts, degradation
- **Font:** Inter (Google Fonts)
- **Philosophy:** Clean, calm, deliberate. No flashy animations, no urgency signals. Every element passes the anti-trading test.

## Development Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # ESLint
```

## Conventions

- App Router (not Pages Router)
- Server Components by default, "use client" only when needed
- Tailwind for all styling, no CSS modules
- All pages in English
