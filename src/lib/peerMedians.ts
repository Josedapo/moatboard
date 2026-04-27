// Peer median multiples by business type — cross-sectional anchor.
//
// The own-history median of a single ticker can be misleading when the
// whole 10-year lookback sits inside an anomalous regime (KNSL post-IPO
// 2016 lived through hard-market insurance + zero rates + flow into
// quality compounders 2020-2024). The 10y median P/B of 7.4x reflects
// that regime, not the durable normal of the underlying business type.
//
// To break the dependency on own-ticker history we maintain a hardcoded
// table of peer medians indexed by yfinance industry (with sector as a
// fallback). Source: Damodaran's annual sector tables 2025
// (pages.stern.nyu.edu/~adamodar/), with manual classification for
// Moatboard tier-A peers where the public ranges are too wide.
//
// The peer median is **not** used to drive the verdict — it triggers a
// disclaimer in the calculator when the current multiple cotizes
// significantly above the peer median, alerting the reader that the
// own-history math may be unrepresentative. The actual escape hatch is
// the override editable (multiple_change_*_override).
//
// Maintenance: this table is intentionally manual. Update annually when
// Damodaran releases new sector tables, or when a new industry shows up
// in Joseda's analysis flow that isn't covered yet. Keys are
// case-sensitive yfinance industry strings using " - " (space-hyphen-
// space) as the separator — verify exact spelling against
// `quote.industry` if a ticker isn't matching.

export type PeerMedianMultipleLabel = "P/E" | "P/FCF" | "P/B";

export type PeerMedianEntry = Partial<
  Record<PeerMedianMultipleLabel, number>
>;

export type PeerMedianResult = {
  value: number;
  source: "industry" | "sector";
  // The exact lookup key that hit — yfinance industry string or
  // sector name. Surfaced to the UI so users see "Insurance - Property
  // & Casualty" instead of just "industria".
  matchKey: string;
};

// Indexed by yfinance industry string (case-sensitive, " - " separator).
// When adding entries, prefer the multiple that matches Moatboard's
// business-type dispatch (P/B for balance-sheet, P/FCF for product
// businesses, P/FCF as proxy for REITs).
const BY_INDUSTRY: Record<string, PeerMedianEntry> = {
  // Balance-sheet businesses → P/B as the meaningful multiple.
  "Banks - Diversified": { "P/B": 1.15 },
  "Banks - Regional": { "P/B": 1.0 },
  "Insurance - Specialty": { "P/B": 1.6 },
  "Insurance - Property & Casualty": { "P/B": 1.5 },
  "Insurance - Diversified": { "P/B": 1.3 },
  "Insurance - Life": { "P/B": 1.0 },
  "Insurance - Reinsurance": { "P/B": 1.1 },
  "Asset Management": { "P/B": 2.5 },
  "Capital Markets": { "P/B": 1.4 },
  "Healthcare Plans": { "P/B": 2.5 },
  "REIT - Mortgage": { "P/B": 0.95 },
  "Mortgage Finance": { "P/B": 1.0 },

  // Equity REITs → P/FCF as proxy for P/AFFO until we persist AFFO.
  "REIT - Specialty": { "P/FCF": 18 },
  "REIT - Industrial": { "P/FCF": 22 },
  "REIT - Residential": { "P/FCF": 20 },
  "REIT - Retail": { "P/FCF": 16 },
  "REIT - Office": { "P/FCF": 14 },
  "REIT - Healthcare Facilities": { "P/FCF": 18 },
  "REIT - Diversified": { "P/FCF": 18 },
  "REIT - Hotel & Motel": { "P/FCF": 14 },

  // Product businesses — P/FCF (and P/E where it's clean).
  "Software - Application": { "P/FCF": 25, "P/E": 28 },
  "Software - Infrastructure": { "P/FCF": 25, "P/E": 28 },
  "Internet Content & Information": { "P/FCF": 28, "P/E": 25 },
  "Internet Retail": { "P/FCF": 26 },
  "Information Technology Services": { "P/FCF": 22, "P/E": 22 },
  "Computer Hardware": { "P/FCF": 18, "P/E": 18 },
  "Consumer Electronics": { "P/FCF": 22, "P/E": 22 },
  Semiconductors: { "P/FCF": 22, "P/E": 22 },
  "Semiconductor Equipment & Materials": { "P/FCF": 22 },
  "Communication Equipment": { "P/FCF": 18 },

  // Financial Services scored as product (per Moatboard dispatch).
  "Credit Services": { "P/FCF": 28, "P/E": 25 },
  "Financial Data & Stock Exchanges": { "P/FCF": 30, "P/E": 28 },

  // Consumer staples / cyclicals.
  "Beverages - Non-Alcoholic": { "P/FCF": 24, "P/E": 22 },
  "Beverages - Wineries & Distilleries": { "P/FCF": 22 },
  "Beverages - Brewers": { "P/FCF": 20 },
  Tobacco: { "P/FCF": 14, "P/E": 14 },
  "Household & Personal Products": { "P/FCF": 22 },
  Restaurants: { "P/FCF": 22 },
  "Specialty Retail": { "P/FCF": 18 },
  "Apparel Retail": { "P/FCF": 18 },
  Lodging: { "P/FCF": 18 },
  "Travel Services": { "P/FCF": 18 },
  "Auto Manufacturers": { "P/FCF": 12, "P/E": 10 },
  "Auto Parts": { "P/FCF": 14 },

  // Industrials.
  "Aerospace & Defense": { "P/FCF": 22, "P/E": 22 },
  "Specialty Industrial Machinery": { "P/FCF": 22 },
  "Industrial Distribution": { "P/FCF": 20 },
  Conglomerates: { "P/FCF": 18, "P/E": 18 },

  // Healthcare.
  "Drug Manufacturers - General": { "P/FCF": 18, "P/E": 18 },
  "Drug Manufacturers - Specialty & Generic": { "P/FCF": 14 },
  "Medical Devices": { "P/FCF": 22, "P/E": 22 },
  "Medical Instruments & Supplies": { "P/FCF": 22 },
  "Diagnostics & Research": { "P/FCF": 22 },

  // Energy.
  "Oil & Gas Integrated": { "P/FCF": 10, "P/E": 12 },
  "Oil & Gas E&P": { "P/FCF": 8, "P/E": 10 },
  "Oil & Gas Midstream": { "P/FCF": 12 },
};

// Sector-level fallback when industry isn't covered.
const BY_SECTOR: Record<string, PeerMedianEntry> = {
  "Financial Services": { "P/B": 1.4, "P/E": 14 },
  "Real Estate": { "P/FCF": 18 },
  Technology: { "P/FCF": 24, "P/E": 24 },
  "Communication Services": { "P/FCF": 24, "P/E": 24 },
  "Consumer Cyclical": { "P/FCF": 18, "P/E": 18 },
  "Consumer Defensive": { "P/FCF": 20, "P/E": 20 },
  Healthcare: { "P/FCF": 20, "P/E": 20 },
  Industrials: { "P/FCF": 20, "P/E": 20 },
  Energy: { "P/FCF": 10, "P/E": 12 },
  "Basic Materials": { "P/FCF": 14, "P/E": 14 },
  Utilities: { "P/E": 18 },
};

export function getPeerMedian({
  sector,
  industry,
  multipleLabel,
}: {
  sector: string | null;
  industry: string | null;
  multipleLabel: PeerMedianMultipleLabel;
}): PeerMedianResult | null {
  if (industry) {
    const entry = BY_INDUSTRY[industry];
    if (entry) {
      const value = entry[multipleLabel];
      if (typeof value === "number" && value > 0) {
        return { value, source: "industry", matchKey: industry };
      }
    }
  }
  if (sector) {
    const entry = BY_SECTOR[sector];
    if (entry) {
      const value = entry[multipleLabel];
      if (typeof value === "number" && value > 0) {
        return { value, source: "sector", matchKey: sector };
      }
    }
  }
  return null;
}
