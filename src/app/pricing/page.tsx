import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Moatboard pricing — free for up to 2 positions, Pro for unlimited portfolio tracking.",
};

export default function Pricing() {
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
              className="text-sm font-medium text-navy-900"
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

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-center text-3xl font-bold text-navy-950">
          Simple Pricing
        </h1>
        <p className="mt-4 text-center text-navy-600">
          Track your businesses. Know if they&apos;re still good.
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {/* Free */}
          <div className="rounded-xl border border-navy-200 p-8">
            <h2 className="text-lg font-semibold text-navy-900">Free</h2>
            <p className="mt-1 text-3xl font-bold text-navy-950">$0</p>
            <p className="mt-1 text-sm text-navy-500">Forever</p>
            <ul className="mt-6 space-y-3 text-sm text-navy-700">
              <li>Up to 2 positions</li>
              <li>AI-generated thesis</li>
              <li>Quality scorecard</li>
              <li>Monthly review</li>
            </ul>
            <Link
              href="/dashboard"
              className="mt-8 block rounded-lg border border-navy-300 py-2 text-center text-sm font-medium text-navy-900 hover:bg-navy-50"
            >
              Get Started
            </Link>
          </div>

          {/* Pro */}
          <div className="rounded-xl border-2 border-navy-900 p-8">
            <h2 className="text-lg font-semibold text-navy-900">Pro</h2>
            <p className="mt-1 text-3xl font-bold text-navy-950">
              $59<span className="text-lg font-normal text-navy-500">/year</span>
            </p>
            <p className="mt-1 text-sm text-navy-500">Less than a coffee per month</p>
            <ul className="mt-6 space-y-3 text-sm text-navy-700">
              <li>Unlimited positions</li>
              <li>AI-generated thesis</li>
              <li>Quality scorecard</li>
              <li>Monthly review</li>
              <li>Rotation suggestions</li>
              <li>Full punch card</li>
            </ul>
            <Link
              href="/dashboard"
              className="mt-8 block rounded-lg bg-navy-900 py-2 text-center text-sm font-medium text-white hover:bg-navy-800"
            >
              Start Free, Upgrade Later
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
