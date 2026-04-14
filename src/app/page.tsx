import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
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
            <Link
              href="/dashboard"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">
            Are your businesses still good?
          </h1>
          <p className="mt-6 text-lg leading-8 text-navy-600">
            The quality dashboard for investors who think like business owners.
            Track your investment theses, monitor quality scorecards, and review
            your positions monthly — not daily.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-lg bg-navy-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
            >
              Start Tracking — Free
            </Link>
            <Link
              href="/about"
              className="text-sm font-semibold text-navy-600 hover:text-navy-900"
            >
              How it works &rarr;
            </Link>
          </div>
        </div>

        {/* Value Props */}
        <div className="mx-auto mt-24 grid max-w-4xl gap-12 sm:grid-cols-3">
          <div>
            <div className="mb-3 text-2xl">&#x1f3af;</div>
            <h3 className="font-semibold text-navy-900">AI-Generated Thesis</h3>
            <p className="mt-2 text-sm text-navy-600">
              Moatboard writes your investment thesis based on fundamentals. You
              refine it. Then we track whether reality still matches.
            </p>
          </div>
          <div>
            <div className="mb-3 text-2xl">&#x1f4ca;</div>
            <h3 className="font-semibold text-navy-900">Quality Scorecard</h3>
            <p className="mt-2 text-sm text-navy-600">
              ROIC, free cash flow, margins, debt, moat indicators — everything
              that tells you if the business is healthy, in one view.
            </p>
          </div>
          <div>
            <div className="mb-3 text-2xl">&#x1f4c5;</div>
            <h3 className="font-semibold text-navy-900">Monthly Review</h3>
            <p className="mt-2 text-sm text-navy-600">
              Once a month, not once a minute. A deliberate ritual to check your
              positions without the noise of daily markets.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-navy-100 py-8 text-center text-sm text-navy-500">
        <p>&copy; {new Date().getFullYear()} Moatboard. Built for business owners, not traders.</p>
      </footer>
    </div>
  );
}
