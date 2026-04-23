"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// UI chrome stays consistent with the editorial mocks Joseda validated
// on 2026-04-22/23. Spanish labels on purpose (see design-system.md §7
// for the rationale).
const NAV = [
  { href: "/dashboard", label: "Cartera", exact: true },
  { href: "/dashboard/watchlist", label: "Watchlist", exact: false },
  { href: "/dashboard/history", label: "Descartes", exact: false },
  { href: "/dashboard/discovery", label: "Discovery", exact: false },
  { href: "/dashboard/inbox", label: "Inbox", exact: false },
];

export default function DashboardNavLinks({
  inboxCount,
}: {
  inboxCount: number;
}) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-8">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const showBadge = item.href === "/dashboard/inbox" && inboxCount > 0;
        const base =
          "relative inline-flex items-center gap-1 text-[12px] font-medium uppercase tracking-[0.08em] no-underline pb-0.5 border-b";
        const state = active
          ? "text-ink border-ink"
          : "text-ink-70 border-transparent hover:text-ink";

        return (
          <Link key={item.href} href={item.href} className={`${base} ${state}`}>
            <span>{item.label}</span>
            {showBadge && (
              <span
                className="ml-1 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-amber px-[5px] font-sans text-[9px] font-semibold leading-none text-paper relative top-[-3px]"
                aria-label={`${inboxCount} señales pendientes`}
              >
                {inboxCount > 99 ? "99+" : inboxCount}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
