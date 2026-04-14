"use server";

import { auth } from "@/auth";
import { createPosition, deletePosition } from "@/lib/positions";
import { validateTicker } from "@/lib/financial";
import { revalidatePath } from "next/cache";

export type ActionState = {
  error?: string;
  success?: boolean;
};

export async function addPositionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const ticker = String(formData.get("ticker") ?? "").trim();
  const purchasePrice = Number(formData.get("purchasePrice"));
  const purchaseDate = String(formData.get("purchaseDate") ?? "");

  if (!ticker || !/^[A-Za-z.]{1,10}$/.test(ticker)) {
    return { error: "Invalid ticker format" };
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    return { error: "Invalid purchase price" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    return { error: "Invalid purchase date" };
  }

  const isValid = await validateTicker(ticker);
  if (!isValid) {
    return { error: `Ticker "${ticker.toUpperCase()}" not found on Yahoo Finance` };
  }

  await createPosition({
    userId: session.user.id,
    ticker,
    purchasePrice,
    purchaseDate,
  });

  revalidatePath("/dashboard");
  return { success: true };
}

export async function deletePositionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return;
  }

  const positionId = Number(formData.get("positionId"));
  if (!Number.isFinite(positionId)) {
    return;
  }

  await deletePosition(positionId, session.user.id);
  revalidatePath("/dashboard");
}
