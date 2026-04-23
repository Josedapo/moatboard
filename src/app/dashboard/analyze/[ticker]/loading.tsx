// Editorial loading skeleton for the guided analysis wizard. First-time
// entry to /analyze/[ticker] resolves session state + sets up the current
// step; regeneration of understanding/red-flags/quality/valuation triggers
// Claude calls of 10-40s each. This shell stays visible while those run.

export default function AnalyzeLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="mb-6 font-display text-[14px] italic text-ink-70">
        Preparing the analysis…
      </p>

      {/* Step indicator skeleton */}
      <div className="mb-10 flex items-center gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-paper-sunk" />
            {i < 4 && <div className="h-px w-10 bg-rule-soft" />}
          </div>
        ))}
      </div>

      {/* Step title */}
      <div className="mb-6">
        <div className="h-3 w-24 bg-paper-sunk" />
        <div className="mt-3 h-7 w-2/3 bg-paper-sunk" />
      </div>

      {/* Content placeholder — 3 faux paragraphs */}
      <div className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3.5 w-full bg-paper-sunk" />
            <div className="h-3.5 w-full bg-paper-sunk" />
            <div className="h-3.5 w-5/6 bg-paper-sunk" />
          </div>
        ))}
      </div>

      <p className="mt-8 font-display text-[13px] italic text-ink-70">
        When Claude is reading a 10-K or writing a summary, this step can
        take 20–40 seconds. The page isn't hung — it's thinking.
      </p>
    </div>
  );
}
