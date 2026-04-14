"use server";

import { auth } from "@/auth";
import { createPosition, deletePosition } from "@/lib/positions";
import { revalidatePath } from "next/cache";

export async function addPositionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const ticker = String(formData.get("ticker") ?? "").trim();
  const purchasePrice = Number(formData.get("purchasePrice"));
  const purchaseDate = String(formData.get("purchaseDate") ?? "");

  if (!ticker || !/^[A-Za-z.]{1,10}$/.test(ticker)) {
    throw new Error("Invalid ticker");
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    throw new Error("Invalid purchase price");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw new Error("Invalid purchase date");
  }

  await createPosition({
    userId: session.user.id,
    ticker,
    purchasePrice,
    purchaseDate,
  });

  revalidatePath("/dashboard");
}

export async function deletePositionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const positionId = Number(formData.get("positionId"));
  if (!Number.isFinite(positionId)) {
    throw new Error("Invalid position id");
  }

  await deletePosition(positionId, session.user.id);
  revalidatePath("/dashboard");
}
