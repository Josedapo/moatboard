"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// UI chrome stays consistent with the editorial mocks Joseda validated
// on 2026-04-22/23. Spanish labels on purpose (see design-system.md §7
// for the rationale).
//
// align='right' items render flush to the right edge of the nav links
// area, separated from the main left-aligned items. Used today only
// for "Agentes" — the operational/admin surface that doesn't share
// scanning patterns with the analytical tabs (Cartera / Watchlist /
// Discovery / Inbox).
type NavItem = {
  href: string;
  label: string;
  exact: boolean;
  align?: "left" | "right";
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Cartera", exact: true },
  { href: "/dashboard/watchlist", label: "Watchlist", exact: false },
  { href: "/dashboard/history", label: "Descartes", exact: false },
  { href: "/dashboard/discovery", label: "Discovery", exact: false },
  { href: "/dashboard/inbox", label: "Inbox", exact: false },
  { href: "/dashboard/agents", label: "Agentes", exact: false, align: "right" },
];

export default function DashboardNavLinks({
  inboxCount,
}: {
  inboxCount: number;
}) {
  const pathname = usePathname();

  const leftItems = NAV.filter((i) => i.align !== "right");
  const rightItems = NAV.filter((i) => i.align === "right");

  const renderLink = (item: NavItem) => {
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
  };

  // flex-1 lets the container take all the space the parent <nav>
  // gives between the brand mark on the left and the email/signout
  // on the right. ml-auto on the right group pushes Agentes flush
  // to the right edge of that area.
  return (
    <div className="flex flex-1 items-center gap-8">
      {leftItems.map(renderLink)}
      {rightItems.length > 0 && (
        <div className="ml-auto flex items-center gap-8">
          {rightItems.map(renderLink)}
        </div>
      )}
    </div>
  );
}
