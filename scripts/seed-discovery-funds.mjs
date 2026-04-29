// Seed the discovery_funds table with the 43 curated world-class funds.
// Idempotent via ON CONFLICT (cik). Safe to re-run; updates display_name,
// tier, tier_weight, philosophy if the roster is edited.
// Run: node scripts/seed-discovery-funds.mjs
//
// 2026-04-29 expansion: +10 funds + Pershing Square reclassified E (0.5) → B (2.0).
// Closes gaps identified in research/top-funds-curation-2026-04.md: macro disciplined
// (Druckenmiller), long-term activism orthogonal to Ackman (ValueAct, Trian),
// old-school US value (Sequoia/Ruane Cunniff, Eagle, Yacktman, Greenhaven),
// international quality compounder (Gardner Russo), capital-cycle (Marathon-London),
// UK concentrated quality (Egerton), Munger-legacy ultra-concentrated (Daily Journal).

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const FUNDS_SEED = [
  // Tier A — Quality Compounders (weight 3.0)
  { cik: "0001569205", manager_name: "Fundsmith LLP", display_name: "Fundsmith", tier: "A", tier_weight: 3.0, philosophy: "Quality compounders, long holding periods" },
  { cik: "0001112520", manager_name: "AKRE CAPITAL MANAGEMENT LLC", display_name: "Akre Capital", tier: "A", tier_weight: 3.0, philosophy: "Three-legged stool: quality business, quality management, reinvestment" },
  { cik: "0001034524", manager_name: "POLEN CAPITAL MANAGEMENT LLC", display_name: "Polen Capital", tier: "A", tier_weight: 3.0, philosophy: "High-quality growth compounders" },
  { cik: "0001096343", manager_name: "MARKEL GROUP INC.", display_name: "Markel", tier: "A", tier_weight: 3.0, philosophy: "Insurance float deployed into quality compounders (Gayner)" },
  { cik: "0001376879", manager_name: "AKO CAPITAL LLP", display_name: "AKO Capital", tier: "A", tier_weight: 3.0, philosophy: "Quality growth, long-only European focus" },
  { cik: "0001484150", manager_name: "Lindsell Train Ltd", display_name: "Lindsell Train", tier: "A", tier_weight: 3.0, philosophy: "Durable brands, concentrated, very low turnover" },
  { cik: "0001279936", manager_name: "CANTILLON CAPITAL MANAGEMENT LLC", display_name: "Cantillon Capital", tier: "A", tier_weight: 3.0, philosophy: "Global quality franchises (Von Mueffling)" },
  { cik: "0001106129", manager_name: "JENSEN INVESTMENT MANAGEMENT INC", display_name: "Jensen Investment", tier: "A", tier_weight: 3.0, philosophy: "15%+ ROE for 10+ years screen; quality-at-reasonable-price" },
  { cik: "0001641864", manager_name: "Giverny Capital Inc.", display_name: "Giverny Capital", tier: "A", tier_weight: 3.0, philosophy: "Owner-operator mindset, quality compounders (Rochon)" },
  { cik: "0000859804", manager_name: "WEDGEWOOD PARTNERS INC", display_name: "Wedgewood Partners", tier: "A", tier_weight: 3.0, philosophy: "Focused quality growth (Rolfe)" },
  { cik: "0001484148", manager_name: "Turtle Creek Asset Management Inc.", display_name: "Turtle Creek", tier: "A", tier_weight: 3.0, philosophy: "Concentrated long-term compounders, 5-10y intrinsic-value doubling screen (Brenton)" },
  { cik: "0001720792", manager_name: "Ruane, Cunniff & Goldfarb L.P.", display_name: "Sequoia / Ruane Cunniff", tier: "A", tier_weight: 3.0, philosophy: "Concentrated US value-quality, Buffett-recommended heir since 1970 (Sequoia Fund)" },
  { cik: "0000945631", manager_name: "EAGLE CAPITAL MANAGEMENT LLC", display_name: "Eagle Capital", tier: "A", tier_weight: 3.0, philosophy: "Concentrated long-only large-cap value-quality, low turnover (Curry, 35+ years)" },
  { cik: "0000860643", manager_name: "GARDNER RUSSO & QUINN LLC", display_name: "Gardner Russo", tier: "A", tier_weight: 3.0, philosophy: "International quality compounders with family-controlled bias (Tom Russo, 40+ years)" },
  { cik: "0000846222", manager_name: "GREENHAVEN ASSOCIATES INC", display_name: "Greenhaven Associates", tier: "A", tier_weight: 3.0, philosophy: "Ultra-concentrated long-term value, 4.5y avg holding period (Wachenheim)" },
  { cik: "0001581811", manager_name: "Egerton Capital (UK) LLP", display_name: "Egerton Capital", tier: "A", tier_weight: 3.0, philosophy: "Concentrated quality long-only, tech/financials bias from London (Armitage, 30+ years)" },

  // Tier B — Value / Value-with-Quality / Activists / Macro (weight 2.0; Druckenmiller 1.5 due to higher quarterly turnover)
  { cik: "0001067983", manager_name: "BERKSHIRE HATHAWAY INC", display_name: "Berkshire", tier: "B", tier_weight: 2.0, philosophy: "Buffett/Munger: quality businesses at fair prices" },
  { cik: "0001166559", manager_name: "BILL & MELINDA GATES FOUNDATION TRUST", display_name: "Gates Foundation", tier: "B", tier_weight: 2.0, philosophy: "Endowment managed on Buffett-influenced principles" },
  { cik: "0001709323", manager_name: "Himalaya Capital Management LLC", display_name: "Himalaya Capital", tier: "B", tier_weight: 2.0, philosophy: "Concentrated value, Munger-mentored (Li Lu)" },
  { cik: "0001173334", manager_name: "PABRAI MOHNISH", display_name: "Pabrai", tier: "B", tier_weight: 2.0, philosophy: "Focused value, 'heads I win, tails I don't lose much'" },
  { cik: "0001404599", manager_name: "Aquamarine Capital Management, LLC", display_name: "Aquamarine", tier: "B", tier_weight: 2.0, philosophy: "Value investing, Buffett/Graham disciples (Spier)" },
  { cik: "0001061768", manager_name: "BAUPOST GROUP LLC/MA", display_name: "Baupost", tier: "B", tier_weight: 2.0, philosophy: "Margin of safety, special situations (Klarman)" },
  { cik: "0001647251", manager_name: "TCI Fund Management Ltd", display_name: "TCI Fund", tier: "B", tier_weight: 2.0, philosophy: "Concentrated long-term activism in high-quality businesses (Hohn)" },
  { cik: "0000813917", manager_name: "HARRIS ASSOCIATES L P", display_name: "Harris Associates", tier: "B", tier_weight: 2.0, philosophy: "Oakmark: value with focus on business quality (Nygren)" },
  { cik: "0001536411", manager_name: "Duquesne Family Office LLC", display_name: "Duquesne Family Office", tier: "B", tier_weight: 1.5, philosophy: "Macro disciplined / concentrated long (Druckenmiller; 30 years zero down years; weight reduced for higher quarterly turnover)" },
  { cik: "0001418814", manager_name: "ValueAct Holdings, L.P.", display_name: "ValueAct Capital", tier: "B", tier_weight: 2.0, philosophy: "Long-term constructive activist, ~5y holding period (Morfit, ex-Ubben)" },
  { cik: "0000905567", manager_name: "YACKTMAN ASSET MANAGEMENT LP", display_name: "Yacktman", tier: "B", tier_weight: 2.0, philosophy: "Disciplined value with quality bias, 30+ years (Don/Stephen Yacktman)" },
  { cik: "0001861026", manager_name: "Marathon Asset Management Ltd", display_name: "Marathon-London", tier: "B", tier_weight: 2.0, philosophy: "Capital cycle approach, capacity discipline (Chancellor's Capital Returns intellectual heritage)" },
  { cik: "0001336528", manager_name: "Pershing Square Capital Management, L.P.", display_name: "Pershing Square", tier: "B", tier_weight: 2.0, philosophy: "Concentrated long-term activist, 11 holdings, 14.7% turnover (Ackman; 15.9% net CAGR since 2004)" },

  // Tier C — Growth / GARP / Activists with succession risk (weight 1.0)
  { cik: "0001167483", manager_name: "TIGER GLOBAL MANAGEMENT LLC", display_name: "Tiger Global", tier: "C", tier_weight: 1.0, philosophy: "Global internet/tech growth (Coleman)" },
  { cik: "0001061165", manager_name: "LONE PINE CAPITAL LLC", display_name: "Lone Pine Capital", tier: "C", tier_weight: 1.0, philosophy: "Tiger cub, global quality growth (Mandel)" },
  { cik: "0001798849", manager_name: "Durable Capital Partners LP", display_name: "Durable Capital", tier: "C", tier_weight: 1.0, philosophy: "Small/mid-cap durable growth (Ellenbogen)" },
  { cik: "0001766908", manager_name: "ShawSpring Partners LLC", display_name: "ShawSpring", tier: "C", tier_weight: 1.0, philosophy: "Concentrated high-quality growth (Hong)" },
  { cik: "0001088875", manager_name: "BAILLIE GIFFORD & CO", display_name: "Baillie Gifford", tier: "C", tier_weight: 1.0, philosophy: "Long-term growth, asymmetric upside" },
  { cik: "0001103804", manager_name: "VIKING GLOBAL INVESTORS LP", display_name: "Viking Global", tier: "C", tier_weight: 1.0, philosophy: "Fundamental long/short, Tiger cub" },
  { cik: "0001766504", manager_name: "GREENLEA LANE CAPITAL MANAGEMENT, LLC", display_name: "Greenlea Lane", tier: "C", tier_weight: 1.0, philosophy: "Concentrated quality growth (Tarasoff)" },
  { cik: "0001345471", manager_name: "TRIAN FUND MANAGEMENT, L.P.", display_name: "Trian Partners", tier: "C", tier_weight: 1.0, philosophy: "Concentrated long-term activism, 7 holdings (Peltz; weight reduced for succession + Disney 2024)" },

  // Tier D — Concentrated / Special Situations (weight 1.0)
  { cik: "0001631664", manager_name: "Punch Card Management L.P.", display_name: "Punch Card", tier: "D", tier_weight: 1.0, philosophy: "Ultra-concentrated, Buffett 'punch card' mental model (Lou)" },
  { cik: "0001773994", manager_name: "Conifer Management, L.L.C.", display_name: "Conifer", tier: "D", tier_weight: 1.0, philosophy: "Concentrated long-term compounders (Alexander)" },
  { cik: "0001657335", manager_name: "Oakcliff Capital Partners, LP", display_name: "Oakcliff", tier: "D", tier_weight: 1.0, philosophy: "Concentrated value, long holding periods (Lawrence)" },
  { cik: "0001553733", manager_name: "Brave Warrior Advisors, LLC", display_name: "Brave Warrior", tier: "D", tier_weight: 1.0, philosophy: "Concentrated value/special situations (Greenberg)" },
  { cik: "0001766596", manager_name: "RV Capital AG", display_name: "RV Capital", tier: "D", tier_weight: 1.0, philosophy: "Business Owner fund, concentrated quality (Vinall)" },
  { cik: "0000783412", manager_name: "DAILY JOURNAL CORP", display_name: "Daily Journal", tier: "D", tier_weight: 1.0, philosophy: "Munger-legacy ultra-concentrated holding, 4 positions, ~0% turnover (post-2023 IC)" },

  // Tier E — Hedge Fund Exceptions (weight 0.5)
  { cik: "0001079114", manager_name: "GREENLIGHT CAPITAL INC", display_name: "Greenlight Capital", tier: "E", tier_weight: 0.5, philosophy: "Value long/short (Einhorn)" },
];

let inserted = 0;
let updated = 0;

for (const f of FUNDS_SEED) {
  const result = await sql`
    INSERT INTO discovery_funds (cik, manager_name, display_name, tier, tier_weight, philosophy)
    VALUES (${f.cik}, ${f.manager_name}, ${f.display_name}, ${f.tier}, ${f.tier_weight}, ${f.philosophy})
    ON CONFLICT (cik) DO UPDATE
      SET manager_name = EXCLUDED.manager_name,
          display_name = EXCLUDED.display_name,
          tier = EXCLUDED.tier,
          tier_weight = EXCLUDED.tier_weight,
          philosophy = EXCLUDED.philosophy
    RETURNING id, (xmax = 0) AS inserted
  `;
  if (result[0].inserted) inserted += 1;
  else updated += 1;
}

console.log(`Seeded ${FUNDS_SEED.length} funds (${inserted} new, ${updated} updated).`);
