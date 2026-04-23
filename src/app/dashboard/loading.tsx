// Editorial loading skeleton for /dashboard. Mirrors the final layout
// (KPI strip + holdings list + aside) with paper-sunk blocks instead of
// data. No animation — design-system §6 rejects motion as attention-
// grabbing. The italic line at the top tells the visitor what's happening.

export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Minimal masthead echo so the chrome doesn't flash in. */}
      <header className="flex items-start justify-between border-b border-ink px-14 pt-7 pb-5">
        <div>
          <div className="font-display text-[32px] font-normal italic leading-none text-ink">
            Moatboard
          </div>
          <div className="mt-1.5 font-display text-[13px] italic font-normal text-ink-70">
            Observatorio Personal de Inversión
          </div>
        </div>
      </header>
      <div className="h-[47px] border-b border-rule-soft bg-paper-dim" />

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-14 py-12">
        <p className="mb-8 font-display text-[14px] italic text-ink-70">
          Opening the observatory…
        </p>

        <div className="grid grid-cols-[1fr_260px] gap-14">
          <div>
            {/* KPI strip skeleton */}
            <div className="mb-10 grid grid-cols-4 border-y border-rule-soft">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`px-4 py-4 ${
                    i < 3 ? "border-r border-rule-soft" : ""
                  }`}
                >
                  <div className="mb-2 h-[10px] w-14 bg-paper-sunk" />
                  <div className="h-7 w-24 bg-paper-sunk" />
                </div>
              ))}
            </div>

            {/* Holdings list skeleton */}
            <div className="mb-5 border-b border-rule-soft pb-2">
              <div className="h-[11px] w-40 bg-paper-sunk" />
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[110px_1fr_160px_130px] gap-6 border-b border-rule-soft py-5 last:border-b-0"
              >
                <div>
                  <div className="h-7 w-14 bg-paper-sunk" />
                  <div className="mt-2 h-[10px] w-20 bg-paper-sunk" />
                </div>
                <div>
                  <div className="h-[18px] w-48 bg-paper-sunk" />
                  <div className="mt-2 h-[10px] w-36 bg-paper-sunk" />
                </div>
                <div className="ml-auto">
                  <div className="ml-auto h-[22px] w-24 bg-paper-sunk" />
                  <div className="ml-auto mt-2 h-[10px] w-32 bg-paper-sunk" />
                </div>
                <div className="ml-auto">
                  <div className="ml-auto h-[20px] w-16 bg-paper-sunk" />
                  <div className="ml-auto mt-2 h-[10px] w-12 bg-paper-sunk" />
                </div>
              </div>
            ))}
          </div>

          <aside className="border-l border-rule-soft pl-9">
            <div className="mb-10">
              <div className="mb-3 h-[10px] w-32 bg-paper-sunk" />
              <div className="h-[160px] border border-rule bg-paper-sunk" />
            </div>
            <div>
              <div className="mb-3 h-[10px] w-32 bg-paper-sunk" />
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex justify-between border-b border-rule-soft py-2.5 last:border-b-0"
                >
                  <div className="h-3.5 w-10 bg-paper-sunk" />
                  <div className="h-3.5 w-16 bg-paper-sunk" />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
