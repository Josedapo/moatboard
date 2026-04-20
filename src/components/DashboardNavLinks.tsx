"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Portfolio", exact: true },
  { href: "/dashboard/watchlist", label: "Watchlist", exact: false },
  { href: "/dashboard/history", label: "History", exact: false },
];

export default function DashboardNavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-6">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active
                ? "text-sm font-medium text-navy-900"
                : "text-sm text-navy-600 hover:text-navy-900"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
