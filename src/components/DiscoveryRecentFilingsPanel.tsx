"use client";

import { useTransition } from "react";
import Link from "next/link";
import type { RecentFilingRow } from "@/lib/discoveryRecentFilings";
import { dismissFilingAction } from "@/app/dashboard/discovery/actions";

// Tier chip colour map — emerald for A (quality compounders) down to
// navy-neutral for E (hedge long-book). Matches the vocabulary used in
// Discovery leaderboard + fund detail headers.
const TIER_CHIP_CLASS: Record<"A" | "B" | "C" | "D" | "E", string> = {
  A: "border-emerald-300 bg-emerald-100 text-emerald-800",
  B: "border-teal-300 bg-teal-100 text-teal-800",
  C: "border-amber-300 bg-amber-100 text-amber-800",
  D: "border-amber-300 bg-amber-100 text-amber-800",
  E: "border-navy-200 bg-navy-100 text-navy-700",
};

export default function DiscoveryRecentFilingsPanel({
  filings,
}: {
  filings: RecentFilingRow[];
}) {
  if (filings.length === 0) return null;

  return (
    <section className="rounded-2xl border border-navy-200 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Novedades · últimos 14 días
        </h2>
        <span className="text-xs text-navy-500">
          {filings.length} {filings.length === 1 ? "filing" : "filings"} sin
          revisar
        </span>
      </header>
      <p className="mt-1 text-xs text-navy-500">
        Fondos del roster que han presentado 13F nuevo. Marca cada uno como
        visto cuando lo revises.
      </p>
      <ul className="mt-4 space-y-2">
        {filings.map((f) => (
          <FilingRow key={f.filing_id} filing={f} />
        ))}
      </ul>
    </section>
  );
}

function FilingRow({ filing }: { filing: RecentFilingRow }) {
  const [isPending, startTransition] = useTransition();
  const onDismiss = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("filingId", String(filing.filing_id));
      await dismissFilingAction(fd);
    });
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-100 bg-navy-50/40 px-3 py-2">
      <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIER_CHIP_CLASS[filing.fund_tier]}`}
        >
          Tier {filing.fund_tier}
        </span>
        <Link
          href={`/dashboard/discovery/fund/${filing.fund_cik}`}
          className="text-sm font-semibold text-navy-900 hover:text-navy-700 hover:underline"
        >
          {filing.fund_display_name}
        </Link>
        <span className="text-xs text-navy-600">
          · 13F de {formatQuarter(filing.period_of_report)}
        </span>
        <span className="text-xs text-navy-500">
          · filado {formatRelativeDate(filing.filing_date)}
        </span>
        <span className="text-xs text-navy-500">
          · {filing.holdings_count}{" "}
          {filing.holdings_count === 1 ? "holding" : "holdings"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/discovery/fund/${filing.fund_cik}`}
          className="whitespace-nowrap rounded-md border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-400 hover:text-navy-900"
        >
          Ver ficha →
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isPending}
          className="whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-navy-500 hover:text-navy-800 disabled:opacity-50"
        >
          {isPending ? "…" : "Marcar visto"}
        </button>
      </div>
    </li>
  );
}

function formatQuarter(ymd: string): string {
  const [yStr, mStr] = ymd.split("-");
  const month = Number(mStr);
  const q = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} ${yStr}`;
}

// "hace 3 días" / "hace 1 semana" / "hoy" — keeps the panel warm
// without turning into a timestamp feed. Above 14 days it falls back
// to a calendar date since the filter window won't normally surface
// anything older, but defensive for edge cases.
function formatRelativeDate(ymd: string): string {
  try {
    const filed = new Date(ymd + "T00:00:00Z");
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.floor((now.getTime() - filed.getTime()) / dayMs);
    if (days <= 0) return "hoy";
    if (days === 1) return "ayer";
    if (days < 7) return `hace ${days} días`;
    if (days < 14) return "hace 1 semana";
    return filed.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return ymd;
  }
}
