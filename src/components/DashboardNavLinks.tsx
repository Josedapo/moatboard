"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Portfolio", exact: true },
  { href: "/dashboard/watchlist", label: "Watchlist", exact: false },
  { href: "/dashboard/history", label: "History", exact: false },
  { href: "/dashboard/inbox", label: "Inbox", exact: false },
];

export default function DashboardNavLinks({
  inboxCount,
}: {
  inboxCount: number;
}) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-6">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const showBadge = item.href === "/dashboard/inbox" && inboxCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "inline-flex items-center gap-2 text-sm font-medium text-navy-900"
                : "inline-flex items-center gap-2 text-sm text-navy-600 hover:text-navy-900"
            }
          >
            <span>{item.label}</span>
            {showBadge && (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
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
