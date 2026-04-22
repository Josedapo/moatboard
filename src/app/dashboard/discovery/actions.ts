"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { dismissFiling } from "@/lib/discoveryRecentFilings";

// Mark a recent 13F filing as "seen" from the Discovery Novedades panel.
// Per-user, permanent (no TTL). Idempotent — reapplying is a no-op.
export async function dismissFilingAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const raw = formData.get("filingId");
  const filingId = Number(raw);
  if (!Number.isFinite(filingId) || filingId <= 0) return;

  await dismissFiling({ userId: session.user.id, filingId });
  revalidatePath("/dashboard/discovery");
}
