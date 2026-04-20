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

  return (
    <nav className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold text-navy-900">
            Moatboard
          </Link>
          <DashboardNavLinks inboxCount={inboxCount} />
        </div>
        <div className="flex items-center gap-6">
          {session?.user && (
            <span className="text-sm text-navy-600">{session.user.email}</span>
          )}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
