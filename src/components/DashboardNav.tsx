import Link from "next/link";
import { auth, signOut } from "@/auth";
import { sql } from "@/lib/db";
import DashboardNavLinks from "./DashboardNavLinks";

export default async function DashboardNav() {
  const session = await auth();

  // Count unreviewed signals to drive the Inbox nav badge. Separate
  // lightweight query — the full list loads inside the inbox page.
  // Silent on error (falls back to 0) so a nav crash can't take the
  // whole app down.
  let inboxCount = 0;
  if (session?.user?.id) {
    try {
      const rows = (await sql`
        SELECT COUNT(*)::INTEGER AS c
        FROM review_signals
        WHERE user_id = ${session.user.id} AND status = 'new'
      `) as unknown as { c: number }[];
      inboxCount = rows[0]?.c ?? 0;
    } catch {
      inboxCount = 0;
    }
  }

  const today = formatMastheadDate(new Date());

  return (
    <>
      <header className="flex items-start justify-between border-b border-ink px-14 pt-7 pb-5">
        <div className="leading-[1.1]">
          <Link
            href="/"
            className="font-display text-[32px] font-normal italic leading-none tracking-[-0.01em] text-ink"
          >
            Moatboard
          </Link>
          <div className="mt-1.5 font-display text-[13px] italic font-normal text-ink-70">
            Observatorio Personal de Inversión
          </div>
        </div>
        <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-70">
          {today}
        </div>
      </header>

      <nav className="flex items-center gap-8 border-b border-rule-soft bg-paper-dim px-14 py-3.5">
        <DashboardNavLinks inboxCount={inboxCount} />
        <span className="flex-1" />
        {session?.user?.email && (
          <span className="font-display text-[13px] italic text-ink-70">
            {session.user.email}
          </span>
        )}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-70 hover:text-ink"
          >
            Salir
          </button>
        </form>
      </nav>
    </>
  );
}

function formatMastheadDate(d: Date): string {
  // "Miércoles · 22 · Abril · 2026" — Spanish long form, caps via CSS.
  const weekday = d.toLocaleDateString("es-ES", { weekday: "long" });
  const day = d.getDate();
  const month = d.toLocaleDateString("es-ES", { month: "long" });
  const year = d.getFullYear();
  return `${cap(weekday)} · ${day} · ${cap(month)} · ${year}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
