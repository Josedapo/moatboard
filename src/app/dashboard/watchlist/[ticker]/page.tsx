// Legacy alias — the canonical ficha lives at /dashboard/ticker/[symbol].
// Canonicalizes the URL ticker (BRK-B → BRK-A, GOOG → GOOGL) and 308s
// there. Bookmarks from before the unification keep working.

import { redirect } from "next/navigation";
import { getCanonicalTicker } from "@/lib/tickerAliases";

type Props = { params: Promise<{ ticker: string }> };

export default async function WatchlistTickerRedirect({ params }: Props) {
  const { ticker } = await params;
  const canonical = (
    await getCanonicalTicker(ticker.toUpperCase())
  ).toUpperCase();
  redirect(`/dashboard/ticker/${canonical}`);
}
