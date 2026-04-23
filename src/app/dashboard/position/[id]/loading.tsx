// Editorial loading skeleton for the position ficha. The first time a
// position opens, ensureAnalysis + ensureValuation + ensureQuarterlySnapshots
// may take 30-60s (SEC EDGAR + yfinance + multiple Claude calls). Until
// then the skeleton mirrors the final layout — header + tabs + panel
// placeholders — so the reader sees the page isn't hung.

export default function PositionLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <p className="mb-6 font-display text-[14px] italic text-ink-70">
        Reading the position…
      </p>

      {/* Header skeleton */}
      <div className="mb-6 flex items-end justify-between gap-8 border-b border-rule pb-6">
        <div className="flex items-end gap-6">
          <div className="h-[64px] w-20 bg-paper-sunk" />
          <div>
            <div className="h-6 w-40 bg-paper-sunk" />
            <div className="mt-2 h-3 w-56 bg-paper-sunk" />
          </div>
        </div>
        <div className="text-right">
          <div className="ml-auto h-9 w-28 bg-paper-sunk" />
          <div className="ml-auto mt-2 h-3 w-20 bg-paper-sunk" />
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="mb-10 flex gap-10 border-b border-rule-soft pb-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3 w-20 bg-paper-sunk" />
        ))}
      </div>

      {/* Body skeleton — mimics the Overview tab shape */}
      <div className="space-y-8">
        <div className="border-l-2 border-ink pl-4">
          <div className="h-5 w-3/4 bg-paper-sunk" />
          <div className="mt-2 h-5 w-2/3 bg-paper-sunk" />
          <div className="mt-2 h-5 w-1/2 bg-paper-sunk" />
        </div>

        <div className="grid grid-cols-5 border-y border-rule-soft">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`px-3 py-4 ${i < 4 ? "border-r border-rule-soft" : ""}`}
            >
              <div className="mb-2 h-2.5 w-16 bg-paper-sunk" />
              <div className="h-5 w-20 bg-paper-sunk" />
            </div>
          ))}
        </div>

        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex gap-5 border-b border-rule-soft py-4 last:border-b-0"
          >
            <div className="h-3 w-20 bg-paper-sunk" />
            <div className="h-3 w-24 bg-paper-sunk" />
            <div className="h-3 flex-1 bg-paper-sunk" />
          </div>
        ))}
      </div>
    </div>
  );
}
