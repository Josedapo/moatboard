// Legacy alias — the canonical ficha lives at /dashboard/ticker/[symbol].
// Resolves the position's ticker (canonicalized for dual-class siblings)
// and 308s there. Bookmarks and inbound `/dashboard/position/${id}` Links
// keep working transparently.
//
// The /trajectory sub-route still hangs off this path because Evolución is
// position-id-driven (one rail per lived position, not per canonical
// ticker), so we don't redirect that branch — Next.js routes /[id] and
// /[id]/trajectory independently.

import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPositionById } from "@/lib/positions";
import { getCanonicalTicker } from "@/lib/tickerAliases";

export default async function PositionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const positionId = Number(id);
  if (!Number.isFinite(positionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const position = await getPositionById(positionId, session.user.id);
  if (!position) notFound();

  const canonical = (
    await getCanonicalTicker(position.ticker)
  ).toUpperCase();
  redirect(`/dashboard/ticker/${canonical}`);
}
