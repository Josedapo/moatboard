import Link from "next/link";
import RequestInvitationForm from "@/components/home/RequestInvitationForm";

// Homepage — Option C "Observatory" (validated 2026-04-23).
// See design-system.md + proposals/2026-04-23-homepage-v1/option-c-observatorio.html
// for the originating mock. Pure server component; only the invitation
// form is a client component (it needs useActionState for pending UX).

const LINEAGE: { name: string; tag: string }[] = [
  { name: "Warren Buffett", tag: "Quality" },
  { name: "Charlie Munger", tag: "Discipline" },
  { name: "Benjamin Graham", tag: "Analysis" },
  { name: "Terry Smith", tag: "Margins" },
  { name: "Chuck Akre", tag: "Capital" },
  { name: "Nick Sleep", tag: "Patience" },
  { name: "Pat Dorsey", tag: "Moat" },
];

const LENSES = [
  {
    order: "01",
    title: "Quality, dimensioned.",
    body: "Seven calibrated dimensions (ROIC, FCF margin, share count, D/E, operating margin, growth, gross margin) scored against the business's own history. No PE used as a proxy for quality.",
  },
  {
    order: "02",
    title: "The business, in plain words.",
    body: "A summary of the 10-K in five sections. It regenerates when a new report is filed; previous versions are archived with their date — the narrative has its own history too.",
  },
  {
    order: "03",
    title: "Evolution, not activity.",
    body: "Every position has a timeline — purchase, quarterly snapshots, today. Compare any two points and see what has changed in quality, moat, and valuation.",
  },
  {
    order: "04",
    title: "Ideas from the best.",
    body: "31 quality-focused funds monitored weekly (Fundsmith, Akre, Polen, Berkshire, AKO, Lindsell Train and more). When one of them moves a ticker you follow, the signal arrives — without the daily noise.",
  },
];

export default function Home() {
  return (
    <div className="bg-paper text-ink">
      {/* ─── Masthead ─── */}
      <div className="mx-auto max-w-[1200px] px-14">
        <div className="mt-9 h-0.5 bg-ink" />
        <header className="border-b border-ink py-9 text-center">
          <div className="font-display text-[88px] font-normal italic leading-none tracking-[-0.02em] text-ink">
            Moatboard.
          </div>
          <div className="mt-3.5 font-display text-[17px] italic text-ink-70">
            Observatorio Personal de Inversión
          </div>
          <div className="mt-[18px] flex justify-between border-t border-rule-soft pt-3.5 font-sans text-[10.5px] font-medium uppercase tracking-[0.28em] text-ink-70">
            <span>A journal of quality investing</span>
            <span>
              {formatMonth(new Date())}
              <span className="mx-2 text-ink-30">·</span>
              By invitation
            </span>
          </div>
        </header>
      </div>

      {/* ─── Body (2-column: essay + sidebar) ─── */}
      <main className="mx-auto max-w-[1200px] px-14 pt-12">
        <div className="grid grid-cols-[1fr_300px] gap-16">
          {/* Main column */}
          <div className="min-w-0">
            <div className="mb-[18px] border-b border-rule-soft pb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-70">
              — About the observatory —
            </div>
            <h1 className="m-0 mb-7 font-display text-[58px] font-light leading-[0.98] tracking-[-0.022em] text-ink">
              One question,
              <br />
              asked <em className="font-normal italic">patiently</em>.
            </h1>

            <div className="essay-columns">
              <p className="essay-lead">
                Moatboard is the personal observatory I use to watch my portfolio. It does not chase visitors, sell subscriptions, or rank {'"'}best stocks.{'"'} It is a digital notebook built around a specific discipline: buying excellent businesses at reasonable prices, holding them, and reviewing them monthly.
              </p>
              <p className="essay-muted">
                The question behind every line of the observatory is always the same. Not {'"'}is it going up?{'"'} — {'"'}is it still a good business?{'"'} Moatboard answers by measuring quality instead of price, and by forcing review when the company reports, not when the market blinks.
              </p>
              <p className="essay-muted">
                The lineage is explicit. Graham as the analytical anchor, Buffett as the quality lens, Munger on circle of competence, Terry Smith on operating margins, Akre on capital allocation, Nick Sleep on the patience of doing nothing.
              </p>
              <p className="essay-muted">
                There are no price charts here. No market notifications, no move counters. Discipline is not imposed from outside with artificial friction — it is what the shape of the product makes possible.
              </p>
            </div>

            {/* Pull quote */}
            <div className="my-14 border-t border-b border-ink py-8 text-center">
              <blockquote className="m-0 mx-auto max-w-[900px] font-display text-[38px] font-light italic leading-[1.25] text-ink">
                “Good decisions are made{" "}
                <em className="font-normal italic">slowly</em>, and rarely.”
              </blockquote>
            </div>

            {/* Mechanics */}
            <div className="pt-15 text-center">
              <h2 className="m-0 font-display text-[48px] font-light leading-none tracking-[-0.022em] text-ink">
                How each <em className="font-normal italic">position</em>{" "}
                reads.
              </h2>
              <p className="mt-3 font-display text-[17px] italic text-ink-70">
                Four lenses. The same question behind each of them.
              </p>
            </div>

            <div className="mt-[22px] grid grid-cols-2 border-t border-l border-rule-soft">
              {LENSES.map((l) => (
                <div
                  key={l.order}
                  className="border-b border-r border-rule-soft px-7 py-6"
                >
                  <div className="mb-2 inline-block font-display text-[15px] italic text-ink-70">
                    {l.order}
                  </div>
                  <h3 className="m-0 mb-2.5 font-display text-[22px] font-normal leading-[1.2] text-ink">
                    {l.title}
                  </h3>
                  <p className="m-0 font-sans text-[13.5px] leading-[1.6] text-ink-70">
                    {l.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="min-w-0 border-l border-rule-soft pl-9">
            <section className="mb-[38px]">
              <h4 className="m-0 mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-70">
                Request an invitation
              </h4>
              <div className="border border-ink bg-paper p-5">
                <p className="m-0 mb-4 font-display text-[14.5px] italic leading-[1.55] text-ink">
                  The observatory opens by invitation. Leave your email and I
                  will send you one when the next batch is ready.
                </p>
                <RequestInvitationForm />
              </div>
            </section>

            <section className="mb-[38px]">
              <h4 className="m-0 mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-70">
                Already invited
              </h4>
              <p className="m-0 font-display text-[14px] italic leading-[1.55] text-ink-70">
                If the observatory already knows you, you can{" "}
                <Link
                  href="/auth/signin"
                  className="border-b border-rule pb-px text-ink no-underline hover:border-ink"
                >
                  sign in →
                </Link>
              </p>
            </section>

            <section>
              <h4 className="m-0 mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-70">
                Lineage
              </h4>
              <div className="pt-1">
                {LINEAGE.map((row, idx) => (
                  <div
                    key={row.name}
                    className={`flex items-baseline justify-between gap-2.5 py-2.5 ${
                      idx === LINEAGE.length - 1
                        ? ""
                        : "border-b border-rule-soft"
                    }`}
                  >
                    <span className="font-display text-[14.5px] text-ink">
                      {row.name}
                    </span>
                    <span className="font-sans text-[10px] uppercase tracking-[0.12em] text-ink-70">
                      {row.tag}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* ─── Colophon ─── */}
      <footer className="mt-[72px] border-t border-ink px-14 py-8 text-center font-display text-[13px] italic leading-[1.8] text-ink-70">
        <span className="font-sans font-medium not-italic text-ink">
          Anti-trading by design.
        </span>{" "}
        No price charts, no market notifications, no counters that cap.
        <br />
        Open access · Personal project · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

function formatMonth(d: Date): string {
  // "April 2026" — matches the masthead issue-line cadence of the mock.
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
