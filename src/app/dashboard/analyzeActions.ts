"use server";

// Per-piece explicit-analyze actions used by the unified ficha at
// `/dashboard/ticker/[symbol]`. Each tab reads its cache read-only on
// render — when the cache is missing it shows a stub with one of these
// actions wired to its button. The user clicks, the expensive Claude /
// 10-K work runs once here, the per-ticker (or per-position) cache
// fills, and the next render shows the real UI.
//
// Anti-trading principle: nothing IA-bound happens at page load. Cost
// is incurred only when the user asks for it.
//
// All actions only need a ticker — Quality and Valuation resolve the
// user's draft position internally via ensureDraftPosition. They
// revalidate the ficha path so the same generation backs the surface
// in a single click.

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { ensureAnalysis, ensureValuation } from "@/lib/positionFlow";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { ensureDraftPosition } from "@/lib/positions";
import {
  getCurrentUnderstanding,
  saveNewUnderstanding,
} from "@/lib/businessUnderstanding";
import { generateBusinessUnderstanding } from "@/lib/businessUnderstandingAi";
import { getRedFlags, saveRedFlags } from "@/lib/redFlags";
import { generateRedFlags } from "@/lib/redFlagsAi";
import {
  prepareBusinessFiling,
  prepareUnderstandingFiling,
  prepareRedFlagsFiling,
} from "@/lib/filingForPrompt";
import { upsertPreAnalysisFromExisting } from "@/lib/preAnalysisFlow";
import { invalidateLeaderboardCache } from "@/lib/discoveryLeaderboard";

async function requireUserId(): Promise<string | number | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function revalidateFicha(ticker: string): void {
  revalidatePath(`/dashboard/ticker/${ticker.toUpperCase()}`);
}

export async function analyzeQualityAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();
  const draft = await ensureDraftPosition(userId, upper);
  await ensureAnalysis(draft.id, upper);
  // Propagate to the shared per-ticker DPA cache. Without this, a row
  // stuck at status='error' from a past pipeline failure (token limit,
  // etc.) would stay 'error' even after the user successfully analyzes
  // the ticker — Discovery would keep showing "no soportado" while the
  // ficha shows a real verdict. Best-effort, never blocks the action.
  await upsertPreAnalysisFromExisting(upper).catch(() => null);
  invalidateLeaderboardCache(userId);
  revalidateFicha(upper);
}

export async function analyzeUnderstandingAction(ticker: string): Promise<void> {
  if (!(await requireUserId())) return;
  const upper = ticker.toUpperCase();
  // Idempotent — if a concurrent request already filled the cache, skip.
  const existing = await getCurrentUnderstanding(upper);
  if (existing) {
    revalidateFicha(upper);
    return;
  }
  const [{ quote, fundamentals }, filing] = await Promise.all([
    fetchQuoteAndFundamentals(upper),
    prepareUnderstandingFiling(upper),
  ]);
  const { generated, model } = await generateBusinessUnderstanding(
    upper,
    quote,
    fundamentals,
    filing,
  );
  await saveNewUnderstanding({
    ticker: upper,
    summaryMd: generated.summary_md,
    questionsAndAnswers: generated.questions_and_answers,
    sources: generated.sources,
    last10kAccession: filing?.accession ?? null,
    last10kPeriodEnd: filing?.reportDate ?? null,
    model,
  });
  revalidateFicha(upper);
}

export async function analyzeRedFlagsAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();
  const existing = await getRedFlags(upper);
  if (existing) {
    revalidateFicha(upper);
    return;
  }
  const [{ quote, fundamentals }, filing] = await Promise.all([
    fetchQuoteAndFundamentals(upper),
    prepareRedFlagsFiling(upper),
  ]);
  const { flags, model } = await generateRedFlags(
    upper,
    quote,
    fundamentals,
    filing,
  );
  await saveRedFlags({
    ticker: upper,
    flags,
    last10kAccession: filing?.accession ?? null,
    last10kPeriodEnd: filing?.reportDate ?? null,
    model,
  });
  // Same propagation as analyzeQualityAction — red flag counts feed the
  // shared DPA cache, which Discovery reads for the chip render.
  await upsertPreAnalysisFromExisting(upper).catch(() => null);
  invalidateLeaderboardCache(userId);
  revalidateFicha(upper);
}

// Combined Understanding + Red flags action — used by the ficha's
// "Negocio" tab where both pieces share a single conceptual surface.
// Single SEC fetch (vs the two that separate analyzeUnderstandingAction
// + analyzeRedFlagsAction would do back-to-back), then two parallel
// Claude calls each with their respective truncation. Idempotent: if
// either piece is already cached, that generator is skipped — useful
// when the user has run one piece via the wizard previously and the
// other is now missing on the ficha.
export async function analyzeBusinessAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();

  const [existingUnderstanding, existingRedFlags] = await Promise.all([
    getCurrentUnderstanding(upper),
    getRedFlags(upper),
  ]);
  if (existingUnderstanding && existingRedFlags) {
    revalidateFicha(upper);
    return;
  }

  // Single fetch + dual truncation. Quote/fundamentals are also shared
  // between both prompts, so fetch them once too.
  const [{ quote, fundamentals }, prepared] = await Promise.all([
    fetchQuoteAndFundamentals(upper),
    prepareBusinessFiling(upper),
  ]);

  // Run only the missing pieces in parallel. Each generator + save is
  // wrapped so a failure in one (e.g. red flags JSON parse blip) does
  // not abort the other.
  const tasks: Promise<unknown>[] = [];

  if (!existingUnderstanding) {
    tasks.push(
      (async () => {
        const { generated, model } = await generateBusinessUnderstanding(
          upper,
          quote,
          fundamentals,
          prepared?.understanding ?? null,
        );
        await saveNewUnderstanding({
          ticker: upper,
          summaryMd: generated.summary_md,
          questionsAndAnswers: generated.questions_and_answers,
          sources: generated.sources,
          last10kAccession: prepared?.understanding?.accession ?? null,
          last10kPeriodEnd: prepared?.understanding?.reportDate ?? null,
          model,
        });
      })().catch((err) =>
        console.error(
          `analyzeBusinessAction: understanding failed for ${upper}: ${(err as Error).message}`,
        ),
      ),
    );
  }

  if (!existingRedFlags) {
    tasks.push(
      (async () => {
        const { flags, model } = await generateRedFlags(
          upper,
          quote,
          fundamentals,
          prepared?.redFlags ?? null,
        );
        await saveRedFlags({
          ticker: upper,
          flags,
          last10kAccession: prepared?.redFlags?.accession ?? null,
          last10kPeriodEnd: prepared?.redFlags?.reportDate ?? null,
          model,
        });
      })().catch((err) =>
        console.error(
          `analyzeBusinessAction: red flags failed for ${upper}: ${(err as Error).message}`,
        ),
      ),
    );
  }

  await Promise.all(tasks);
  // Same propagation as the per-piece actions — only red flags affects
  // DPA counts, but cheap to call either way (idempotent).
  await upsertPreAnalysisFromExisting(upper).catch(() => null);
  invalidateLeaderboardCache(userId);
  revalidateFicha(upper);
}

export async function analyzeValuationAction(ticker: string): Promise<void> {
  const userId = await requireUserId();
  if (!userId) return;
  const upper = ticker.toUpperCase();
  const draft = await ensureDraftPosition(userId, upper);
  const { quote, fundamentals } = await fetchQuoteAndFundamentals(upper);
  await ensureValuation(draft.id, upper, quote, fundamentals);
  revalidateFicha(upper);
}
