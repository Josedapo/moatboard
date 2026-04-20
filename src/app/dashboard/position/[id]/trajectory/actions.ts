"use server";

import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { validateMoat } from "@/lib/moatValidationAi";
import {
  createMoatValidation,
  type MoatValidation,
} from "@/lib/moatValidations";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";

// Revalidates the moat registered on a past snapshot against Claude's
// current view of the business. Persists to the per-snapshot
// `moat_validations` table — NOT to the global `moat_assessments` cache —
// so exploratory validations from the trajectory don't silently mutate
// what the main position card, future quarterly snapshots, or other
// users see. Multiple validations against the same snapshot are allowed
// and form a revalidation history.
export async function revalidateMoatAction({
  positionId,
  ticker,
  fromSnapshotId,
  originalArchetype,
  originalStrength,
  originalReasoning,
  originalRecordedAt,
}: {
  positionId: number;
  ticker: string;
  fromSnapshotId: number;
  originalArchetype: MoatArchetype;
  originalStrength: MoatStrength;
  originalReasoning: string;
  originalRecordedAt: string;
}): Promise<MoatValidation> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  // Defence in depth: confirm the position belongs to this user so the
  // action can't be invoked with a fabricated positionId.
  const position = await getPositionById(positionId, session.user.id);
  if (!position) {
    throw new Error("Position not found");
  }
  if (position.ticker.toUpperCase() !== ticker.toUpperCase()) {
    throw new Error("Ticker mismatch");
  }

  const { quote } = await fetchQuoteAndFundamentals(ticker);

  const { validation, model } = await validateMoat({
    ticker,
    quote,
    originalArchetype,
    originalStrength,
    originalReasoning,
    originalRecordedAt,
  });

  return createMoatValidation({
    userId: session.user.id,
    positionId,
    ticker,
    fromSnapshotId,
    originalArchetype,
    originalStrength,
    originalReasoning,
    originalRecordedAt,
    verdict: validation.verdict,
    newArchetype: validation.newArchetype,
    newStrength: validation.newStrength,
    reasoning: validation.reasoning,
    model,
  });
}
