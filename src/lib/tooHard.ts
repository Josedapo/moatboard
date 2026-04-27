// Munger's "too hard pile": businesses whose future is structurally
// unpredictable even for an attentive analyst. Not because they're bad —
// many produce excellent returns — but because the skill required to
// underwrite them sits outside most investors' circle of competence.
//
// We only flag a ticker as "too hard" when BOTH:
//  1. Its sector / industry matches the predefined list below, AND
//  2. The moat engine returns archetype = "none" or strength = "weak".
//
// The reasoning: Buffett owns biotech (Moody's is technically B2B data, but
// he owned large stakes in See's-like branded biotechs via Berkshire). The
// "too hard" is not the sector itself — it's a sector WITHOUT a clear
// durable advantage. A biotech with no moat IS too hard; a biotech with
// sustained IP moat (Gilead circa 2015, Eli Lilly's long franchises) is
// legitimately underwritable.

import type { MoatArchetype, MoatStrength } from "@/lib/verdict";

// Keys are case-sensitive yfinance strings. Industries use " - "
// (space-hyphen-space) as separator — verify against peerMedians.ts or
// quote.industry before adding new entries (em-dash "—" silently fails).

const HARD_SECTORS = new Set([
  "Basic Materials",
  "Energy",
  "Utilities",
]);

const HARD_INDUSTRIES = new Set([
  "Biotechnology",
  "Drug Manufacturers - Specialty & Generic",
  "Airlines",
  "Oil & Gas E&P",
  "Oil & Gas Drilling",
  "Oil & Gas Refining & Marketing",
  "Coal",
  "Copper",
  "Silver",
  "Gold",
  "Aluminum",
  "Uranium",
  "Resorts & Casinos",
  "Gambling",
  "Semiconductor Equipment & Materials",
  "REIT - Mortgage",
]);

export type TooHardAssessment = {
  isHard: boolean;
  reason: string | null;
};

export function assessTooHard({
  sector,
  industry,
  moatStrength,
  moatArchetype,
}: {
  sector: string | null;
  industry: string | null;
  moatStrength: MoatStrength;
  moatArchetype: MoatArchetype;
}): TooHardAssessment {
  const sectorHit = sector ? HARD_SECTORS.has(sector) : false;
  const industryHit = industry ? HARD_INDUSTRIES.has(industry) : false;

  if (!sectorHit && !industryHit) {
    return { isHard: false, reason: null };
  }

  const noMoat = moatArchetype === "none" || moatStrength === "weak";
  if (!noMoat) {
    return { isHard: false, reason: null };
  }

  const category = industryHit ? industry : sector;
  return {
    isHard: true,
    reason: `${category}: outcomes here depend on unpredictable variables (clinical trial results, commodity prices, regulation, cyclical demand) that even attentive analysts can't reliably forecast. Without a durable moat to ride through those swings, this falls into Munger's "too hard pile" — not a bad business, but not one a buy-and-hold investor can responsibly underwrite long term.`,
  };
}
