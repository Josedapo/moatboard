"use client";

// Free-form ticker input on the Cartera dashboard. Submitting routes
// to /dashboard/comprar/[TICKER] where the buy form lives. No
// autocomplete by design — the user knows what they're buying.

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AddPositionForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = value.trim();
    // Yahoo Finance share-class hyphen form: BRK.A / BRK/A → BRK-A.
    const normalized = raw.replace(/[./]/g, "-").toUpperCase();
    if (!normalized || !/^[A-Z-]{1,10}$/.test(normalized)) return;
    router.push(`/dashboard/comprar/${normalized}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ticker"
        maxLength={10}
        autoComplete="off"
        className="w-24 border border-rule-soft bg-paper px-2 py-1 font-display text-[13px] uppercase tracking-[0.05em] text-ink placeholder:normal-case placeholder:italic placeholder:text-ink-30 focus:border-ink focus:outline-none"
      />
      <button
        type="submit"
        disabled={value.trim().length === 0}
        className="bg-ink px-3 py-1 font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-paper disabled:opacity-40"
      >
        Añadir acción
      </button>
    </form>
  );
}
