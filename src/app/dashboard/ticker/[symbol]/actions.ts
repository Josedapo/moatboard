"use server";

// Universal ficha actions. Post-2026-04-28 watchlist refactor: the
// previous lifecycle transitions (in_portfolio / watchlist / discarded)
// collapsed into a single watchlist toggle plus the new
// /dashboard/comprar/[ticker] flow for buying. This file now only
// surfaces the toggle.

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { addToWatchlist, removeFromWatchlist } from "@/lib/watchlistEntries";

async function requireUserId(): Promise<string | number | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

// Toggle watchlist membership. `intent='remove'` deletes the entry;
// any other value adds (or refreshes last_touched_at). Pure tag
// operation — no fields persisted.
export async function toggleWatchlistAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;

  const intent = String(formData.get("intent") ?? "");
  const upper = ticker.toUpperCase();
  const canonical = await getCanonicalTicker(upper);

  if (intent === "remove") {
    await removeFromWatchlist({ userId, ticker: canonical });
  } else {
    await addToWatchlist({ userId, ticker: canonical });
  }

  revalidatePath(`/dashboard/ticker/${canonical}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/watchlist");
  revalidatePath("/dashboard/discovery");
}
