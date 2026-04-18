import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Moatboard thinks about business quality — the investing tradition behind the product, the investors who defined it, the seven quality dimensions, and how we translate their thinking into a scorecard.",
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
            <Link href="/about" className="text-sm font-medium text-navy-900">
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

      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        {/* Hero */}
        <header className="mb-16">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-navy-500">
            Methodology
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">
            How Moatboard thinks about quality
          </h1>
          <p className="mt-6 text-lg leading-8 text-navy-600">
            Moatboard is a faithful translation of a specific investing
            tradition. This page explains the tradition, the investors who
            defined it, and how we translate their thinking into the scorecard
            you see.
          </p>
          <blockquote className="mt-10 border-l-4 border-navy-300 pl-5 text-lg italic leading-relaxed text-navy-700">
            &ldquo;The best business to own is one that over an extended period
            can employ large amounts of incremental capital at very high rates
            of return.&rdquo;
            <footer className="mt-2 text-sm not-italic text-navy-500">
              — Warren Buffett, 1992 Berkshire shareholder letter
            </footer>
          </blockquote>

          <nav className="mt-10 rounded-lg bg-navy-50 p-5 text-sm">
            <p className="mb-2 font-semibold text-navy-900">On this page</p>
            <ul className="space-y-1 text-navy-700">
              <li>
                <a href="#philosophy" className="hover:text-navy-900">
                  1. Why quality investing exists
                </a>
              </li>
              <li>
                <a href="#investors" className="hover:text-navy-900">
                  2. The investors who defined the framework
                </a>
              </li>
              <li>
                <a href="#dimensions" className="hover:text-navy-900">
                  3. The seven quality dimensions
                </a>
              </li>
              <li>
                <a href="#tier" className="hover:text-navy-900">
                  4. How the final tier is computed
                </a>
              </li>
              <li>
                <a href="#not-scored" className="hover:text-navy-900">
                  5. What we deliberately do NOT score
                </a>
              </li>
              <li>
                <a href="#not" className="hover:text-navy-900">
                  6. What Moatboard is NOT
                </a>
              </li>
              <li>
                <a href="#coverage" className="hover:text-navy-900">
                  7. What Moatboard covers
                </a>
              </li>
              <li>
                <a href="#reading" className="hover:text-navy-900">
                  8. Further reading
                </a>
              </li>
            </ul>
          </nav>
        </header>

        {/* Section 1 — Philosophy */}
        <section id="philosophy" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            1. Why quality investing exists
          </h2>
          <div className="space-y-5 text-base leading-relaxed text-navy-800">
            <p>
              The conventional way to look at stocks is through their prices:
              what the chart is doing, what the market mood is, where the
              analyst consensus points. That framing treats the investor as a
              speculator — someone betting on short-term direction.
            </p>
            <p>
              Quality investing starts somewhere else. It treats a share as
              what it legally is: part-ownership of a business. The question
              isn&apos;t &ldquo;will the price go up next quarter?&rdquo; but
              &ldquo;is this a business worth owning for the next ten or twenty
              years?&rdquo;
            </p>
            <p>
              That reframing changes everything. Daily charts become noise.
              Analyst price targets become trivia. The only thing that matters
              is whether the underlying business is <em>good</em> — whether it
              earns high returns on the capital it deploys, whether it can keep
              doing so, and whether management allocates that capital in the
              shareholder&apos;s interest.
            </p>
            <p>
              The tradition that built this framework spans almost a century:
              Benjamin Graham in the 1930s, Warren Buffett and Charlie Munger
              from the 1960s onward, and today a generation of practitioners —
              Terry Smith, Charlie Akre, Nick Sleep, Pat Dorsey, Mohnish Pabrai
              — who write and invest in the same line.
            </p>
            <p>
              Moatboard is an attempt to build a tool that is{" "}
              <em>faithful</em> to that tradition: not marketing-Buffett with a
              different wrapper, but a scorecard calibrated on what these
              investors actually measure, in their own words.
            </p>
          </div>
        </section>

        {/* Section 2 — Investors */}
        <section id="investors" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            2. The investors who defined the framework
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            Every dimension Moatboard scores traces back to a specific source.
            These are the investors whose letters, books, and portfolios we
            read to calibrate the product.
          </p>

          <div className="space-y-6">
            <InvestorCard
              name="Benjamin Graham"
              years="1894–1976"
              contribution="The origin point. Graham gave the tradition its founding concepts — intrinsic value, margin of safety. You don't pay what a business might be worth in the best case; you pay meaningfully less, so you can be wrong and still not lose. Buffett studied under him at Columbia."
              quote="An investment operation is one which, upon thorough analysis, promises safety of principal and an adequate return."
              source="The Intelligent Investor, 1949"
            />
            <InvestorCard
              name="Warren Buffett"
              years="1930–"
              contribution="Evolved Graham's framework from statistical bargains to quality at a fair price. His 1991 letter defines an 'economic franchise' as a business that can raise prices without losing customers — the most concise definition of a moat ever written. His 1986 letter introduced owner earnings, a stricter version of free cash flow that Moatboard uses in its DCF."
              quote="It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price."
              source="1989 Berkshire shareholder letter"
            />
            <InvestorCard
              name="Charlie Munger"
              years="1924–2023"
              contribution="Converted Buffett from Graham-style cigar-butt investing to the quality-compounder philosophy that defines Berkshire today. His lattice-of-mental-models approach insists that no single metric can capture business quality — hence Moatboard's insistence on seven independent dimensions instead of a compound score."
              quote="The big money is not in the buying and selling, but in the waiting."
              source="Poor Charlie's Almanack"
            />
            <InvestorCard
              name="Terry Smith"
              years="1953–"
              contribution="Built Fundsmith on five measurable metrics: ROCE, gross margin, operating margin, cash conversion, and interest coverage. Fundsmith's portfolio averages ~64% gross margin vs. ~45% for the S&P 500 — the single most differentiated headline number in his universe. Moatboard's seven-dimension scorecard mirrors Smith's list closely."
              quote="A high quality business is one which can sustain a high return on operating capital employed. In cash."
              source="Fundsmith Owner's Manual, 2024 edition"
            />
            <InvestorCard
              name="Charlie Akre"
              years="1943–"
              contribution={"Akre's 'three-legged stool' frames quality investing as the intersection of (1) an extraordinary business, (2) talented management with integrity, and (3) a long runway to reinvest at high returns. The compounding math he emphasizes is what makes holding for decades — rather than trading — the actual source of wealth."}
              quote="The rate at which the value of a business compounds will approximate its returns on reinvestment."
              source="Akre Capital Management investment philosophy"
            />
            <InvestorCard
              name="Nick Sleep"
              years="1966–"
              contribution="Sleep's 'scale economies shared' framework identifies businesses that pass scale advantages back to customers rather than keeping them as margin — Costco, Amazon, Carpetright. These businesses grow their moat by growing: a customer never leaves because the value proposition keeps improving."
              quote="Scale economies shared."
              source="Nomad Investment Partnership letters, 2001–2014"
            />
            <InvestorCard
              name="Pat Dorsey"
              years="1970–"
              contribution="Dorsey taxonomized competitive advantages into four sources: intangible assets (brand, patent, license), switching costs, network effects, and cost advantages. Moatboard's moat engine uses this taxonomy directly — every position is tagged with one of these archetypes (or none)."
              quote="The key to successful investing is to identify companies with wide economic moats — and then buy them at reasonable prices."
              source="The Little Book That Builds Wealth, 2008"
            />
          </div>
        </section>

        {/* Section 3 — Dimensions */}
        <section id="dimensions" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            3. The seven quality dimensions
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            Moatboard scores every business on seven independent dimensions.
            Each comes from a specific source in the tradition. Each is
            calibrated to what these investors consider{" "}
            <em>strong</em>, <em>acceptable</em>, or <em>weak</em>.
          </p>
          <p className="mb-10 text-base leading-relaxed text-navy-800">
            When multi-year data is available, Moatboard uses the median across
            roughly five years of annual filings <em>and</em> requires the
            worst single year to also clear a floor — so cyclical peaks
            don&apos;t earn a &ldquo;strong&rdquo; that the trough would
            reveal as temporary.
          </p>

          <div className="space-y-10">
            <DimensionCard
              number="1"
              name="Return on invested capital (ROIC)"
              measures="How much the business earns on every dollar of productive capital it deploys. A business with 20% ROIC creates 20 cents of value for every dollar invested."
              rationale="Buffett's 1987 letter names 'return on equity capital without excessive leverage' as the primary test of managerial economic performance. Terry Smith calls it the signal. Akre calls the same number 'the return on owner's capital.' It is the single best compressed measure of a moat in action."
              thresholds={[
                { label: "Strong", detail: "median ≥ 15% AND worst year ≥ 10%" },
                { label: "Acceptable", detail: "median ≥ 10% AND worst year ≥ 5%" },
                { label: "Weak", detail: "below the acceptable floor" },
              ]}
            />
            <DimensionCard
              number="2"
              name="Gross margin"
              measures="What the business earns on each product or service after paying direct costs, before overhead. Sustained high gross margin is the observable fingerprint of pricing power — brand, patent, network effect, switching cost."
              rationale="Buffett's 1991 franchise definition describes a business 'not subject to price regulation' that can 'regularly price aggressively' — of which gross margin is the evidence. Terry Smith: Fundsmith's portfolio averages ~64% gross margin. Robert Novy-Marx (Journal of Financial Economics, 2013): 'the farther down the income statement one goes, the more polluted profitability measures become.'"
              thresholds={[
                { label: "Strong", detail: "median ≥ 50% AND worst year ≥ 40%" },
                { label: "Acceptable", detail: "median ≥ 35% AND worst year ≥ 25%" },
                {
                  label: "Neutral (not scored)",
                  detail:
                    "for banks, insurers, commodity producers, asset managers, and real estate — where gross margin is undefined (revenue is net interest or net premium) or dominated by commodity cycles.",
                },
              ]}
            />
            <DimensionCard
              number="3"
              name="Free cash flow margin"
              measures="How much free cash flow the business generates per dollar of revenue — the cash left after paying for everything, including capex. A business with 20% FCF margin can survive a 50% revenue drop without burning cash."
              rationale="Buffett's 1986 letter introduced owner earnings precisely because GAAP net income can diverge from cash. Smith's fifth metric is cash conversion (FCF / Net Income); FCF margin is its per-revenue cousin."
              thresholds={[
                { label: "Strong", detail: "median ≥ 15% AND worst year ≥ 8%" },
                { label: "Acceptable", detail: "median ≥ 8% AND worst year ≥ 2%" },
                { label: "Weak", detail: "below" },
              ]}
            />
            <DimensionCard
              number="4"
              name="Operating margin"
              measures="Profit after all operating costs — COGS, SG&A, R&D, depreciation — before interest and tax. Captures overhead discipline and operating leverage, things gross margin by itself misses."
              rationale="Gross margin isolates pricing power; operating margin adds SG&A discipline on top. A business that has pricing power but can't control overhead is a different kind of flawed from one that has neither. Smith scores both."
              thresholds={[
                { label: "Strong", detail: "median ≥ 20% AND worst year ≥ 10%" },
                { label: "Acceptable", detail: "median ≥ 10% AND worst year ≥ 5%" },
                { label: "Weak", detail: "below" },
              ]}
            />
            <DimensionCard
              number="5"
              name="Share count trend"
              measures="Whether management has returned capital to shareholders (buybacks reducing share count) or diluted them (issuing shares, typically for acquisitions or stock compensation)."
              rationale="Buybacks at fair prices compound value per share; dilution without commensurate growth destroys it. Buffett's capital allocation philosophy is explicit on this (1999 letter especially). Over five years, share count trend is the cleanest management-quality proxy available without reading 10-K narratives."
              thresholds={[
                { label: "Strong", detail: "shares shrinking ≥ 1% per year (net buybacks)" },
                { label: "Acceptable", detail: "flat (±1%)" },
                { label: "Weak", detail: "dilution > 1% per year" },
              ]}
            />
            <DimensionCard
              number="6"
              name="Debt / equity"
              measures="How leveraged the balance sheet is. Low debt is non-negotiable for the long-term holder — a small chance of distress cannot be offset by a large chance of extra returns."
              rationale={"Buffett, 1989: \u201Ca small chance of distress or disgrace cannot, in our view, be offset by a large chance of extra returns.\u201D Moatboard uses debt/equity (rather than interest coverage) because it's robust for businesses with little or no debt, where interest coverage becomes undefined."}
              thresholds={[
                { label: "Strong", detail: "D/E < 50%" },
                { label: "Acceptable", detail: "D/E < 100%" },
                { label: "Weak", detail: "D/E ≥ 100%" },
              ]}
            />
            <DimensionCard
              number="7"
              name="Revenue growth"
              measures="Whether the business has a runway — somewhere to reinvest retained earnings at the same high ROIC. A high-ROIC business with no growth eventually gets valued as a bond; a high-ROIC business growing 10%+ real is a compounder."
              rationale={"Buffett, 1992: \u201CGrowth is always a component in the calculation of value\u2026 only when each dollar used to finance the growth creates over a dollar of long-term market value.\u201D Akre's compounding math ties ROIC to growth directly. Five-year CAGR smooths the single-year noise and reveals structural trajectory."}
              thresholds={[
                { label: "Strong", detail: "5-year CAGR ≥ 10%" },
                { label: "Acceptable", detail: "5-year CAGR ≥ 5%" },
                { label: "Weak", detail: "below" },
              ]}
            />
          </div>
        </section>

        {/* Section 4 — Tier */}
        <section id="tier" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            4. How the final tier is computed
          </h2>
          <p className="mb-6 text-base leading-relaxed text-navy-800">
            Moatboard combines the seven scored dimensions and the moat
            assessment into one of four tiers:
          </p>

          <div className="space-y-4">
            <TierCard
              color="emerald"
              label="Exceptional business"
              description="Essentially all scoreable dimensions strong (at most one non-strong allowed), no weaks, and a strong identifiable moat. Only a small fraction of US public companies clear this bar. Reserved for the Costco-class compounders."
            />
            <TierCard
              color="teal"
              label="Good business"
              description="Clear majority strong, at most one weak, moat at least plausible. A genuinely ownable business for the long-term investor."
            />
            <TierCard
              color="amber"
              label="Mediocre business"
              description="Mixed signals. Real strengths offset by real weaknesses. In the Buffett/Munger framework, the punch card is for wonderful or good businesses at the right price; mediocre is the default answer, not a third option to own."
            />
            <TierCard
              color="red"
              label="Poor business"
              description="Multiple dimensions failing, or the moat engine found no identifiable moat. The things Buffett cares about are absent or broken here."
            />
          </div>

          <div className="mt-10 space-y-5 text-base leading-relaxed text-navy-800">
            <p>
              <strong className="text-navy-900">
                Sector-aware neutralization.
              </strong>{" "}
              When a dimension doesn&apos;t apply to the business (e.g. gross
              margin on a bank — revenue is net interest income with no COGS
              concept), Moatboard returns <em>neutral</em> for that dimension.
              The tier thresholds scale accordingly: a 6-applicable-dimension
              bank faces the same proportional bar as a 7-applicable-dimension
              industrial, not a harder one.
            </p>
            <p>
              <strong className="text-navy-900">
                The &ldquo;too hard&rdquo; modifier.
              </strong>{" "}
              When a business combines a hard-to-predict sector (biotech,
              airlines, oil &amp; gas exploration, metals) with no identifiable
              moat, the tier is downgraded one level — Moatboard&apos;s own
              statement that the business is outside the circle of competence
              a buy-and-hold investor can responsibly underwrite.
              Munger&apos;s &ldquo;too hard pile&rdquo; made structural.
            </p>
            <p>
              <strong className="text-navy-900">
                Valuation method adapts to the business.
              </strong>{" "}
              Intrinsic value is not estimated the same way for every
              business. A generic discounted-cash-flow model on a bank
              double-counts capital requirements; on a REIT it misreads
              property depreciation as a real economic drag. Moatboard
              routes positions to the right method: <em>owner-earnings
              two-stage DCF</em> for product businesses (Buffett 1986),
              <em> AFFO-based DCF</em> for real-estate businesses (industry
              standard — Net Income + D&amp;A − maintenance capex
              approximates Funds From Operations net of maintenance), and
              the <em>Excess Returns Model</em> for banks, insurers and
              asset managers (Damodaran: book value + PV of (ROE − Cost of
              Equity) × equity over a 10-year horizon). When none of the
              absolute methods apply — pre-profit growth companies, broken
              data — the toolkit falls back to sector-multiples. The four
              methods share the same Bear / Base / Bull presentation so the
              visual vocabulary doesn&apos;t change, only the math
              underneath.
            </p>
          </div>
        </section>

        {/* Section 5 — Not scored */}
        <section id="not-scored" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            5. What we deliberately do NOT score
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            Transparency matters. Here is what we considered and chose not to
            include as scored dimensions, and why.
          </p>

          <div className="space-y-6">
            <NotScoredCard
              name="Current ratio"
              reason="Graham's 1949 defensive-investor rule said current ratio ≥ 2.0. Buffett, Munger, Smith, Akre, Pabrai, Dorsey, and Sleep all omit it. Negative-working-capital business models (Costco, Dell, Amazon, McDonald's) fail the rule while being among the most financially resilient businesses in history — they collect cash from customers before paying suppliers, which is a feature, not a weakness. Scoring current ratio would penalize exactly the kinds of businesses the quality tradition prizes. It's shown as a reference card only."
            />
            <NotScoredCard
              name="Return on equity (ROE)"
              reason="Buffett's 1987 letter is explicit: ROE can be inflated by leverage. A company with 18% ROE and 200% debt/equity looks strong on ROE but is fragile. ROIC strips the leverage out. Moatboard shows ROE in the reference signals, labeled 'distorted by leverage — see D/E.'"
            />
            <NotScoredCard
              name="P/E, P/B, P/FCF ratios"
              reason="These are valuation questions, not quality questions. Whether a business is a good business is independent of what the market is currently paying for it. Moatboard surfaces them in the separate Valuation section as independent tools — never as tier inputs and never combined into a single buy/sell verdict."
            />
            <NotScoredCard
              name="Management quality"
              reason="Buffett says management is half the thesis. But management doesn't compress into a score without distortion: insider ownership is structurally tiny at mega-caps; CEO tenure cuts both ways; compensation requires sector peers to read. Moatboard surfaces the raw signals (CEO pay, insider activity, tenure, employee count) in the AI-generated thesis narrative, where they can be reasoned about rather than flattened."
            />
            <NotScoredCard
              name="Forward earnings estimates"
              reason="Analyst consensus is not information the buy-and-hold investor should trust, per Buffett's repeated warnings about the 'institutional imperative.' Moatboard's DCF uses observed growth (recent five-year CAGR), not analyst projections."
            />
            <NotScoredCard
              name="Retention multiple (Buffett's one-dollar test)"
              reason="Buffett's 1983 letter asks: for every dollar the business retains (net income not paid as dividend), has it created at least a dollar of market value? We compute the ratio over the available 5-year window and surface it as a reference signal — but we don't score it. The test is directional and noisy over 5 years because market-cap change blends value creation with multiple expansion. It's most informative at extremes (≥ 1.5x or < 0) and gets folded into the management narrative when relevant, rather than contributing to the tier."
            />
          </div>
        </section>

        {/* Section 6 — What Moatboard is NOT */}
        <section id="not" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            6. What Moatboard is NOT
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            Equally important to state what this product does not try to be.
          </p>

          <ul className="space-y-5 text-base leading-relaxed text-navy-800">
            <li>
              <strong className="text-navy-900">
                Not a screener to discover winners.
              </strong>{" "}
              Moatboard evaluates businesses you already want to own. Discovery
              is a future feature built from the same framework, but the core
              product is not a &ldquo;find cheap stocks&rdquo; engine.
            </li>
            <li>
              <strong className="text-navy-900">
                Not a trading signal.
              </strong>{" "}
              Nothing on the scorecard changes in a week. The tier moves on
              real business changes — annual filings, moat erosion, management
              changes — not on price movements.
            </li>
            <li>
              <strong className="text-navy-900">
                Not a price forecast.
              </strong>{" "}
              Moatboard does not predict where the stock goes next quarter,
              next year, or next decade. Nobody can. The product is built on
              the belief that <em>if the business is good</em>, the price takes
              care of itself over the long term.
            </li>
            <li>
              <strong className="text-navy-900">
                Not a substitute for reading 10-Ks.
              </strong>{" "}
              The scorecard compresses a lot of signal, but a thesis still
              requires understanding the business — its product, customers,
              competitive dynamics, management&apos;s track record. Moatboard
              accelerates the analysis; it does not replace it.
            </li>
          </ul>
        </section>

        {/* Section 7 — Coverage */}
        <section id="coverage" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            7. What Moatboard covers
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            Moatboard is opinionated about what it analyzes. The framework
            is built around a specific tradition of quality investing —
            applying it indiscriminately to every public company would
            produce confident-sounding verdicts the model can&apos;t
            actually back. Here is the honest map of what the product does
            well, what it handles partially, and what it explicitly opts
            out of.
          </p>

          <h3 className="mb-3 text-base font-bold text-navy-900">
            Well covered — the framework applies faithfully
          </h3>
          <ul className="mb-6 space-y-3 text-base leading-relaxed text-navy-800">
            <li>
              <strong>Product businesses</strong> (software, consumer
              staples, consumer durables, industrials, healthcare products,
              specialty chemicals, branded platforms) — scored on the seven
              Buffett / Terry Smith dimensions; valued with the
              owner-earnings two-stage DCF.
            </li>
            <li>
              <strong>Banks, insurers, asset managers, mortgage finance</strong>{" "}
              — scored on the balance-sheet dimensions (ROE, ROA, book
              value per share CAGR) plus Op Margin, Share Count, Revenue
              Growth; valued with Damodaran&apos;s Excess Returns Model on
              book value.
            </li>
            <li>
              <strong>Health insurers</strong> (UnitedHealth, Cigna, Humana,
              Elevance) — even though yfinance classifies them under the
              Healthcare sector, they are structurally balance-sheet
              businesses (premium revenue, claims expense) and receive the
              same treatment as banks and P&amp;C insurers.
            </li>
            <li>
              <strong>Equity REITs</strong> (net lease, industrial, cell
              tower, data center, healthcare) — scored on AFFO payout ratio,
              Net Debt / EBITDA, AFFO per share CAGR, plus FCF margin /
              Share Count / Revenue Growth; valued with AFFO-based DCF.
            </li>
            <li>
              <strong>Mortgage REITs</strong> — though in the Real Estate
              sector, they operate as spread businesses on mortgage-backed
              securities, not property operators. They&apos;re routed to
              the bank framework (Excess Returns + bank scorecard) because
              ROE and book value compounding are the honest signals; AFFO
              isn&apos;t defined in a meaningful sense.
            </li>
            <li>
              <strong>Payment networks, financial data providers,
              exchanges</strong> (Visa, Mastercard, Moody&apos;s, S&amp;P
              Global, ICE, CME) — classified by yfinance as Financial
              Services but they are product businesses with meaningful
              cost-of-revenue, gross margin, and ROIC. Treated as product
              businesses, not banks.
            </li>
          </ul>

          <h3 className="mb-3 text-base font-bold text-navy-900">
            Partially covered — framework applies with caveats
          </h3>
          <ul className="mb-6 space-y-3 text-base leading-relaxed text-navy-800">
            <li>
              <strong>Utilities and regulated infrastructure</strong> (NEE,
              DUK, SO) — the DCF runs and the scorecard works, but a
              dividend discount model would fit these businesses better
              than a general DCF. Current output is usable but
              not optimal.
            </li>
            <li>
              <strong>Commodity producers</strong> (energy E&amp;P,
              miners, specialty commodities) — gross margin is neutralized
              because it swings with the commodity cycle, not pricing
              power. Other dimensions still score. The &ldquo;too hard&rdquo;
              modifier downgrades the tier one level when combined with a
              weak or absent moat — Munger&apos;s pile, made structural.
            </li>
            <li>
              <strong>Specialty consumer finance</strong> (pure auto
              lenders, student loan servicers) — the yfinance industry
              string doesn&apos;t cleanly distinguish them from payment
              networks, so they&apos;re currently treated as product
              businesses. Their ROIC will self-penalize because the
              business model is capital-heavy; no code-level fix until
              ticker-level classification is available.
            </li>
          </ul>

          <h3 className="mb-3 text-base font-bold text-navy-900">
            Not covered — Moatboard will say so explicitly
          </h3>
          <p className="mb-4 text-base leading-relaxed text-navy-800">
            When a business falls outside the framework, the position page
            replaces the scorecard and valuation with a clear notice:{" "}
            <em>&ldquo;Moatboard can&apos;t analyze this business.&rdquo;</em>{" "}
            We would rather surface the limit than anchor you on a tier the
            model doesn&apos;t actually support. Common cases:
          </p>
          <ul className="mb-6 space-y-3 text-base leading-relaxed text-navy-800">
            <li>
              <strong>Pre-revenue growth companies</strong> — no owner
              earnings to discount, too few years of meaningful history to
              score trends.
            </li>
            <li>
              <strong>Deep cyclicals at trough earnings</strong> — the
              scorecard returns mostly weak or neutral, and the framework
              can&apos;t distinguish a cyclical bottom from a structurally
              broken business.
            </li>
            <li>
              <strong>Crypto-native companies</strong> — balance sheets
              dominated by token holdings, earnings driven by market price
              of assets rather than operating performance.
            </li>
            <li>
              <strong>SPACs and shell companies</strong> — no operating
              business yet.
            </li>
            <li>
              <strong>Recent IPOs with fewer than three years of filings</strong>{" "}
              — insufficient history to score multi-year dimensions
              honestly.
            </li>
          </ul>
          <p className="mb-6 text-base leading-relaxed text-navy-800">
            This is deliberate. Quality investing in the Buffett / Munger /
            Smith line is, by design, a narrow universe. Moatboard&apos;s
            job isn&apos;t to analyze everything — it&apos;s to analyze
            well what fits.
          </p>

          <h3 className="mb-3 text-base font-bold text-navy-900">
            How far back the history goes
          </h3>
          <p className="mb-4 text-base leading-relaxed text-navy-800">
            For US-listed businesses, Moatboard reads fundamentals from SEC
            EDGAR&apos;s XBRL archive, typically 10–18 years back depending
            on when the filer became subject to XBRL reporting (the 2009
            mandate phased in through 2011). Spin-offs naturally start at the
            spin date, not the parent&apos;s history. Where SEC coverage is
            missing — no XBRL filings, foreign-only filers, or pink-sheet
            tickers — the fundamentals feed falls back to a shorter
            third-party window of four to five years. Prices, beta,
            sector / industry, analyst snapshots and dividend yield remain
            sourced outside SEC in every case, since XBRL does not cover
            market data.
          </p>
          <p className="text-base leading-relaxed text-navy-800">
            Even with longer data available, the scorecard medians and
            worst-year cuts are computed on the most recent 10 years only.
            Buffett&apos;s 1987 letter endorsed exactly that screen
            (&ldquo;average ROE above 20% with no single year below 15%&rdquo;
            over 1977-1986), and Terry Smith&apos;s quality criteria use a
            10-year margin-consistency filter. Fifteen- or twenty-year
            medians would cross regime changes (pre/post-GFC, pre/post-cloud,
            management turnovers, transformative M&amp;A) that distort the
            signal rather than strengthen it. The full EDGAR history still
            informs the moat narrative and the Buffett retention-multiple
            test — it&apos;s only the quality scorecard that caps at ten.
          </p>
        </section>

        {/* Section 8 — Further reading */}
        <section id="reading" className="mb-16 scroll-mt-20">
          <h2 className="mb-5 text-2xl font-bold text-navy-950">
            8. Further reading
          </h2>
          <p className="mb-8 text-base leading-relaxed text-navy-800">
            If this tradition is new to you, or if you want to verify the
            primary sources Moatboard builds on:
          </p>

          <ul className="space-y-4 text-base leading-relaxed text-navy-800">
            <li>
              <strong>Berkshire Hathaway shareholder letters</strong> — Warren
              Buffett, 1977 to present. The 1977, 1983, 1986, 1987, 1989, 1991
              and 1992 letters contain the core articulation of the framework.
              Available at{" "}
              <a
                href="https://www.berkshirehathaway.com/letters/letters.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy-900 underline hover:no-underline"
              >
                berkshirehathaway.com/letters
              </a>
              .
            </li>
            <li>
              <strong>The Intelligent Investor</strong> — Benjamin Graham,
              1949/1973. Chapter 20 on margin of safety is the foundation.
            </li>
            <li>
              <strong>Poor Charlie&apos;s Almanack</strong> — edited by Peter
              Kaufman. The breadth of Munger&apos;s thinking — mental models,
              misjudgement biases, the lollapalooza effect.
            </li>
            <li>
              <strong>Fundsmith Equity Fund Owner&apos;s Manual</strong> —
              Terry Smith, 2024 edition, at{" "}
              <a
                href="https://www.fundsmith.co.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy-900 underline hover:no-underline"
              >
                fundsmith.co.uk
              </a>
              . The cleanest articulation of a modern quality-investing
              framework in print.
            </li>
            <li>
              <strong>The Little Book That Builds Wealth</strong> — Pat Dorsey,
              2008. The moat taxonomy Moatboard uses.
            </li>
            <li>
              <strong>Nomad Investment Partnership letters</strong> — Nick
              Sleep &amp; Qais Zakaria, 2001–2014.
              &ldquo;Scale economies shared&rdquo; framework applied to Costco,
              Amazon, and others.
            </li>
            <li>
              <strong>Akre Capital Management investment philosophy</strong> —
              at{" "}
              <a
                href="https://www.akrecapital.com/investment-approach/our-investment-philosophy/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy-900 underline hover:no-underline"
              >
                akrecapital.com
              </a>
              . The three-legged stool, plain and short.
            </li>
            <li>
              <strong>
                &ldquo;The Other Side of Value: The Gross Profitability
                Premium&rdquo;
              </strong>{" "}
              — Robert Novy-Marx, <em>Journal of Financial Economics</em>,
              2013. Academic backing for gross margin as the cleanest
              profitability measure.
            </li>
          </ul>
        </section>

        {/* Closing */}
        <section className="mt-20 border-t border-navy-100 pt-10">
          <p className="text-base leading-relaxed text-navy-700">
            Moatboard is an opinionated product. The scorecard reflects one
            specific investment tradition — quality investing in the
            Buffett/Munger/Smith line. If that tradition doesn&apos;t match how
            you invest, the tool may not fit you. That&apos;s a feature:
            Moatboard is built for the investor who wants to own businesses for
            decades, not for the trader looking for the next 10% move.
          </p>
          <blockquote className="mt-8 border-l-4 border-navy-300 pl-5 text-lg italic leading-relaxed text-navy-700">
            &ldquo;The big money is not in the buying and selling, but in the
            waiting.&rdquo;
            <footer className="mt-2 text-sm not-italic text-navy-500">
              — Charlie Munger
            </footer>
          </blockquote>
        </section>
      </main>

      <footer className="border-t border-navy-100 py-8 text-center text-sm text-navy-500">
        <p>
          &copy; {new Date().getFullYear()} Moatboard. Built for business
          owners, not traders.
        </p>
      </footer>
    </div>
  );
}

function InvestorCard({
  name,
  years,
  contribution,
  quote,
  source,
}: {
  name: string;
  years: string;
  contribution: string;
  quote: string;
  source: string;
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold text-navy-950">{name}</h3>
        <span className="text-xs text-navy-500">{years}</span>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-navy-800">
        {contribution}
      </p>
      <blockquote className="border-l-2 border-navy-200 pl-4 text-sm italic text-navy-700">
        &ldquo;{quote}&rdquo;
        <footer className="mt-1 text-xs not-italic text-navy-500">
          — {source}
        </footer>
      </blockquote>
    </div>
  );
}

function DimensionCard({
  number,
  name,
  measures,
  rationale,
  thresholds,
}: {
  number: string;
  name: string;
  measures: string;
  rationale: string;
  thresholds: { label: string; detail: string }[];
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-sm font-semibold text-navy-400">{number}.</span>
        <h3 className="text-lg font-bold text-navy-950">{name}</h3>
      </div>
      <dl className="space-y-4 text-sm leading-relaxed text-navy-800">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">
            What it measures
          </dt>
          <dd className="mt-1">{measures}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">
            Why it&apos;s in the scorecard
          </dt>
          <dd className="mt-1">{rationale}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">
            Thresholds
          </dt>
          <dd className="mt-2">
            <ul className="space-y-1.5">
              {thresholds.map((t) => (
                <li
                  key={t.label}
                  className="rounded-md bg-navy-50 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-navy-900">
                    {t.label}:
                  </span>{" "}
                  <span className="text-navy-700">{t.detail}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function TierCard({
  color,
  label,
  description,
}: {
  color: "emerald" | "teal" | "amber" | "red";
  label: string;
  description: string;
}) {
  const styles: Record<typeof color, { border: string; dot: string }> = {
    emerald: { border: "border-l-emerald-500", dot: "bg-emerald-500" },
    teal: { border: "border-l-teal-500", dot: "bg-teal-500" },
    amber: { border: "border-l-amber-500", dot: "bg-amber-500" },
    red: { border: "border-l-red-500", dot: "bg-red-500" },
  };
  const s = styles[color];
  return (
    <div
      className={`flex gap-4 rounded-lg border border-navy-100 bg-white p-5 ${s.border} border-l-4`}
    >
      <div className="flex-none pt-2">
        <span className={`block h-2.5 w-2.5 rounded-full ${s.dot}`}></span>
      </div>
      <div>
        <h3 className="mb-1 font-bold text-navy-950">{label}</h3>
        <p className="text-sm leading-relaxed text-navy-700">{description}</p>
      </div>
    </div>
  );
}

function NotScoredCard({
  name,
  reason,
}: {
  name: string;
  reason: string;
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white p-6">
      <h3 className="mb-2 text-base font-bold text-navy-950">{name}</h3>
      <p className="text-sm leading-relaxed text-navy-700">{reason}</p>
    </div>
  );
}
