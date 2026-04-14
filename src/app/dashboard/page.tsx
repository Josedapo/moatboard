import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function Dashboard() {
  return (
    <div className="flex min-h-screen flex-col">
      <nav className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-xl font-bold text-navy-900">
            Moatboard
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/about"
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Methodology
            </Link>
            <Link
              href="/pricing"
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Pricing
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto flex max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16">
        <h1 className="text-2xl font-bold text-navy-950">Your Portfolio</h1>
        <p className="mt-4 text-navy-600">
          Authentication coming soon. This is where you&apos;ll track your businesses.
        </p>
        <div className="mt-8 rounded-xl border-2 border-dashed border-navy-200 px-12 py-16 text-center">
          <p className="text-sm text-navy-500">No positions yet</p>
          <button className="mt-4 rounded-lg bg-navy-900 px-6 py-2 text-sm font-medium text-white hover:bg-navy-800">
            + Add Position
          </button>
        </div>
      </main>
    </div>
  );
}
