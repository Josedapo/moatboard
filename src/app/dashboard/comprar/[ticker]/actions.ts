"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import {
  ensureDraftPosition,
  getPositionByTicker,
  updatePositionPreCommitment,
} from "@/lib/positions";
import {
  createTransaction,
  getCostBasis,
} from "@/lib/positionTransactions";
import { createTransactionalSnapshot } from "@/lib/snapshotFlow";
import { addToWatchlist } from "@/lib/watchlistEntries";

// Records a buy transaction. Reachable from:
//   · The wizard's StepValuation "Comprar acciones" CTA
//   · The Decisión tab on /dashboard/ticker/[symbol]
//   · The "Añadir acción" button on the Cartera dashboard
//
// pre_commitment_md is required ONLY on the first buy of a ticker
// (transition draft → live). On subsequent adds the field is just an
// optional operation_note appended to the transaction.
export async function recordBuyTransactionAction(
  ticker: string,
  formData: FormData,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const userId = session.user.id;

  const upper = ticker.toUpperCase();
  const canonical = await getCanonicalTicker(upper);

  const purchasePrice = Number(formData.get("purchase_price"));
  const purchaseDate = String(formData.get("purchase_date") ?? "");
  const shares = Number(formData.get("shares"));
  const preCommitment = String(formData.get("pre_commitment_md") ?? "").trim();
  const operationNote = String(formData.get("operation_note") ?? "").trim();
  const addToWatchlistAfter = formData.get("add_to_watchlist") === "on";

  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    throw new Error("Precio de compra inválido");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw new Error("Fecha de compra inválida");
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error("Número de acciones inválido");
  }

  // Determine if this is the first buy on this ticker. Live position
  // means at least one prior transaction; if none, we're transitioning
  // a draft to a lived position (or creating one fresh).
  const existing = await getPositionByTicker(userId, canonical);
  const positionId = existing
    ? existing.id
    : (await ensureDraftPosition(userId, canonical)).id;

  let isFirstBuy = true;
  if (existing) {
    const basis = await getCostBasis(positionId);
    isFirstBuy = basis.shares <= 1e-9;
  }

  if (isFirstBuy && preCommitment.length === 0) {
    throw new Error(
      "El compromiso de salida es obligatorio en la primera compra de un ticker",
    );
  }

  // First buy: persist the position-level commitment. Subsequent adds
  // do not overwrite the position-level commitment — that's the durable
  // anchor; per-op notes are the operation_note column.
  if (isFirstBuy && preCommitment.length > 0) {
    await updatePositionPreCommitment({
      positionId,
      userId,
      text: preCommitment,
    });
  }

  // Operation note for subsequent buys lives in the (legacy-named)
  // pre_commitment_md column on position_transactions. The first buy
  // can also carry an operation_note alongside the position-level
  // commitment.
  const txn = await createTransaction({
    positionId,
    type: "buy",
    transactionDate: purchaseDate,
    price: purchasePrice,
    shares,
    preCommitmentMd: operationNote.length > 0 ? operationNote : null,
  });

  await createTransactionalSnapshot({
    userId,
    positionId,
    transactionId: txn.id,
  });

  if (addToWatchlistAfter) {
    await addToWatchlist({ userId, ticker: canonical });
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/ticker/${canonical}`);
  revalidatePath(`/dashboard/position/${positionId}`);
  redirect(`/dashboard/position/${positionId}`);
}
