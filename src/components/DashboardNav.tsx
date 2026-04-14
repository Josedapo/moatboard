import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function DashboardNav() {
  const session = await auth();

  return (
    <nav className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-bold text-navy-900">
          Moatboard
        </Link>
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
