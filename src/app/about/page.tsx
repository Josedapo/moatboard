import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Moatboard evaluates business quality — the scorecard methodology, thesis tracking, and anti-trading philosophy.",
};

export default function About() {
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
              className="text-sm font-medium text-navy-900"
            >
              Methodology
            </Link>
            <Link
              href="/pricing"
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Pricing
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold text-navy-950">Methodology</h1>
        <p className="mt-4 text-navy-600">
          Coming soon — how Moatboard evaluates business quality and tracks your
          investment theses.
        </p>
      </main>
    </div>
  );
}
