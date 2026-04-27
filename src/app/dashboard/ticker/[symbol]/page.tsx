// Universal ticker → ficha dispatcher.
//
// Surfaces from anywhere in the app (Discovery leaderboard, future
// callers like Inbox / fund detail / cross-references) need to send
// the user to "the ficha for this ticker" without knowing which page
// owns the surface for the user's specific relationship with it. The
// per-state pages each have their own URL semantic:
//
//   in_portfolio                    → /dashboard/position/[id]
//   discarded                       → /dashboard/position/[id] (closed view)
//   watchlist                       → /dashboard/watchlist/[ticker]
//   no state, but has analysis      → /dashboard/position/[id] (draft)
//   no state, no analysis           → /dashboard/analyze/[ticker]
//
// This route reads the user's relationship with the ticker and 302s
// to the right place. Clients only need /dashboard/ticker/[symbol].

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { getTickerState } from "@/lib/tickerStates";

type Props = { params: Promise<{ symbol: string }> };

export default async function TickerDispatchPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }
  const userId = session.user.id;

  const { symbol } = await params;
  const ticker = (await getCanonicalTicker(symbol.toUpperCase())).toUpperCase();

  const state = await getTickerState({ userId, ticker });

  // Watchlist has its own dedicated tabbed view that mirrors the
  // position ficha — semantically the right destination only when
  // status is exactly 'watchlist' (the page 404s otherwise).
  if (state?.status === "watchlist") {
    redirect(`/dashboard/watchlist/${ticker}`);
  }

  // Any other state (in_portfolio / discarded) — or no state but a
  // cached position from a prior wizard session — resolves to the
  // position page, which renders for both live (transactions) and
  // draft (anchor for cached analysis) rows.
  const rows = (await sql`
    SELECT id FROM positions
     WHERE user_id = ${userId} AND ticker = ${ticker}
     ORDER BY id DESC
     LIMIT 1
  `) as { id: number }[];

  if (rows[0]) {
    redirect(`/dashboard/position/${rows[0].id}`);
  }

  // Truly first contact — start the analysis wizard.
  redirect(`/dashboard/analyze/${ticker}`);
}
