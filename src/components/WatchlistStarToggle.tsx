"use client";

// Watchlist star toggle. Pure tag — no fields, no modal, no reason
// captured. Click to add / remove. Visible from Discovery rows, ficha
// header, position page header, and the wizard's WizardShell header.
//
// Server action invoked through a hidden form so the component can run
// in any context (Server Component or Client Component) and rely on the
// platform's optimistic-update story (transitions + revalidatePath in
// the action). For instant feedback we also flip a local `pending` flag
// — the star animates immediately while the action runs.

import { useTransition, useState } from "react";
import { toggleWatchlistAction } from "@/app/dashboard/ticker/[symbol]/actions";

type Props = {
  ticker: string;
  isOnWatchlist: boolean;
  size?: "sm" | "md";
  className?: string;
};

export default function WatchlistStarToggle({
  ticker,
  isOnWatchlist,
  size = "md",
  className = "",
}: Props) {
  const [optimistic, setOptimistic] = useState(isOnWatchlist);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("intent", next ? "add" : "remove");
      try {
        await toggleWatchlistAction(ticker, fd);
      } catch (err) {
        // Roll back optimistic state on failure.
        setOptimistic(!next);
        console.error(`toggleWatchlistAction failed for ${ticker}:`, err);
      }
    });
  };

  const dimensions = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={
        optimistic
          ? `Quitar ${ticker} de la watchlist`
          : `Añadir ${ticker} a la watchlist`
      }
      title={
        optimistic
          ? "En watchlist · pulsa para quitar"
          : "Añadir a watchlist"
      }
      className={`inline-flex items-center justify-center rounded-md p-1 transition-colors ${
        optimistic
          ? "text-amber-500 hover:text-amber-700"
          : "text-navy-300 hover:text-amber-500"
      } ${isPending ? "opacity-50" : ""} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={optimistic ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        className={dimensions}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.32.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.32-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
        />
      </svg>
    </button>
  );
}
