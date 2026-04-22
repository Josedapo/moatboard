// Pure Form 4 XML parser. Extracts issuer + reporting-owner + non-
// derivative transactions. Regex-based — Form 4 schema is stable
// since 2005 (ownership.xsd) so the tag names don't move. Keeps
// the dependency footprint zero.
//
// Not extracted: derivative transactions (options, RSUs). Phase 1
// scope is open-market purchases of common stock only; derivatives
// are either grants (noise) or exercises (neutral). Can be added as
// a separate export later.

export type Form4Transaction = {
  transactionDate: string; // YYYY-MM-DD
  transactionCode: string; // 'P' = open market purchase, 'S' = sale, 'A' = award, 'M' = option exercise, etc.
  acquiredDisposed: "A" | "D";
  shares: number;
  pricePerShare: number; // 0 for grants; real USD/share for purchases
  rule10b5_1Flag: boolean | null; // null when the tag is absent (pre-2023 filings)
  directOrIndirect: "D" | "I";
};

export type ParsedForm4 = {
  issuerCik: string;
  issuerName: string;
  issuerTradingSymbol: string | null;
  reportingOwnerCik: string;
  reportingOwnerName: string;
  reportingOwnerTitle: string | null; // raw text from XML (e.g. "Chief Executive Officer")
  isOfficer: boolean;
  isDirector: boolean;
  isTenPercentOwner: boolean;
  nonDerivativeTransactions: Form4Transaction[];
};

// Extract the first value inside <tagName>…</tagName>, possibly nested
// inside a <value> wrapper. Returns null when the tag is absent or empty.
function extractTagText(xml: string, tagName: string): string | null {
  // Accept optional <value>…</value> wrapper (common in Form 4 schema).
  const re = new RegExp(
    `<${tagName}>\\s*(?:<value>([\\s\\S]*?)</value>\\s*)?([\\s\\S]*?)</${tagName}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "").trim();
  if (!raw) return null;
  return raw;
}

// Extract every <tagName>…</tagName> occurrence (returns the raw inner XML
// of each, for subsequent sub-extraction).
function extractAllTagContents(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function parseBooleanFlag(raw: string | null): boolean {
  if (raw === null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

function parseFloatSafe(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseForm4Xml(xml: string): ParsedForm4 {
  // Issuer
  const issuerCik = extractTagText(xml, "issuerCik") ?? "";
  const issuerName = extractTagText(xml, "issuerName") ?? "";
  const issuerTradingSymbol = extractTagText(xml, "issuerTradingSymbol");

  // Reporting owner — all nested inside <reportingOwner>.
  const ownerBlock = extractAllTagContents(xml, "reportingOwner")[0] ?? "";
  const reportingOwnerCik = extractTagText(ownerBlock, "rptOwnerCik") ?? "";
  const reportingOwnerName =
    extractTagText(ownerBlock, "rptOwnerName") ?? "";

  // Title: inside <reportingOwnerRelationship><officerTitle>
  const relationshipBlock =
    extractAllTagContents(ownerBlock, "reportingOwnerRelationship")[0] ?? "";
  const reportingOwnerTitle =
    extractTagText(relationshipBlock, "officerTitle");
  const isOfficer = parseBooleanFlag(
    extractTagText(relationshipBlock, "isOfficer"),
  );
  const isDirector = parseBooleanFlag(
    extractTagText(relationshipBlock, "isDirector"),
  );
  const isTenPercentOwner = parseBooleanFlag(
    extractTagText(relationshipBlock, "isTenPercentOwner"),
  );

  // Non-derivative transactions
  const nonDerivativeBlock =
    extractAllTagContents(xml, "nonDerivativeTable")[0] ?? "";
  const txBlocks = extractAllTagContents(
    nonDerivativeBlock,
    "nonDerivativeTransaction",
  );

  const nonDerivativeTransactions: Form4Transaction[] = [];
  for (const tx of txBlocks) {
    const transactionDate =
      extractTagText(tx, "transactionDate") ?? "";
    const codingBlock =
      extractAllTagContents(tx, "transactionCoding")[0] ?? "";
    const transactionCode =
      extractTagText(codingBlock, "transactionCode") ?? "";

    const amountsBlock =
      extractAllTagContents(tx, "transactionAmounts")[0] ?? "";
    const sharesRaw = extractTagText(amountsBlock, "transactionShares");
    const priceRaw = extractTagText(
      amountsBlock,
      "transactionPricePerShare",
    );
    const acquiredDisposedRaw = extractTagText(
      amountsBlock,
      "transactionAcquiredDisposedCode",
    );

    const acquiredDisposed: "A" | "D" =
      acquiredDisposedRaw === "D" ? "D" : "A";

    // rule10b5_1 flag — tag added in 2023. Absent → null (unknown).
    // Present and "1"/"true" → true; "0"/"false" → false.
    const hasRule10b5_1Tag = /<rule10b5_1Flag>/i.test(tx);
    const rule10b5_1Raw = extractTagText(tx, "rule10b5_1Flag");
    const rule10b5_1Flag = hasRule10b5_1Tag
      ? parseBooleanFlag(rule10b5_1Raw)
      : null;

    // Direct or indirect ownership
    const postBlock =
      extractAllTagContents(tx, "postTransactionAmounts")[0] ?? "";
    const ownershipBlock =
      extractAllTagContents(tx, "ownershipNature")[0] ?? "";
    const directOrIndirectRaw =
      extractTagText(ownershipBlock, "directOrIndirectOwnership") ??
      extractTagText(postBlock, "directOrIndirectOwnership");
    const directOrIndirect: "D" | "I" =
      directOrIndirectRaw === "I" ? "I" : "D";

    nonDerivativeTransactions.push({
      transactionDate,
      transactionCode,
      acquiredDisposed,
      shares: parseFloatSafe(sharesRaw),
      pricePerShare: parseFloatSafe(priceRaw),
      rule10b5_1Flag,
      directOrIndirect,
    });
  }

  return {
    issuerCik: issuerCik.padStart(10, "0"),
    issuerName,
    issuerTradingSymbol,
    reportingOwnerCik: reportingOwnerCik.padStart(10, "0"),
    reportingOwnerName,
    reportingOwnerTitle,
    isOfficer,
    isDirector,
    isTenPercentOwner,
    nonDerivativeTransactions,
  };
}

// Classification helper used by form4Flow before deciding whether to
// emit a signal. Keeps title matching in one place.
export function isCeoOrCfo(title: string | null): boolean {
  if (!title) return false;
  return /chief executive|ceo|chief financial|cfo/i.test(title);
}
