import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCanonicalTicker } from "@/lib/tickerAliases";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { getPositionByTicker } from "@/lib/positions";
import { getCostBasis } from "@/lib/positionTransactions";
import { sql } from "@/lib/db";
import DashboardNav from "@/components/DashboardNav";
import QualityBadge from "@/components/QualityBadge";
import { recordBuyTransactionAction } from "./actions";
import type { Tier } from "@/lib/verdict";

export const metadata = { title: "Comprar" };

type Props = { params: Promise<{ ticker: string }> };

export default async function ComprarPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const userId = session.user.id;

  const { ticker: rawTicker } = await params;
  const tickerInput = rawTicker.toUpperCase();
  const canonical = (await getCanonicalTicker(tickerInput)).toUpperCase();

  const [{ quote }, existing] = await Promise.all([
    fetchQuoteAndFundamentals(canonical),
    getPositionByTicker(userId, canonical),
  ]);

  // Determine first-buy vs add. First-buy → pre_commitment required.
  let isFirstBuy = true;
  let existingShares = 0;
  let avgCost = 0;
  let firstBuyDate: string | null = null;
  if (existing) {
    const basis = await getCostBasis(existing.id);
    if (basis.shares > 1e-9) {
      isFirstBuy = false;
      existingShares = basis.shares;
      avgCost = basis.avg_cost_per_share ?? 0;
      const firstTx = (await sql`
        SELECT transaction_date::text AS d
          FROM position_transactions
         WHERE position_id = ${existing.id}
         ORDER BY transaction_date ASC
         LIMIT 1
      `) as { d: string }[];
      firstBuyDate = firstTx[0]?.d ?? null;
    }
  }

  // Read-only context: tier from the user's most recent moatboard_analyses
  // (or shared cache fallback).
  const tierRow = (await sql`
    SELECT ma.tier
      FROM moatboard_analyses ma
      JOIN positions p ON p.id = ma.position_id
     WHERE p.user_id = ${userId}
       AND p.ticker = ${canonical}
     ORDER BY ma.generated_at DESC
     LIMIT 1
  `) as { tier: Tier }[];
  const fallbackTier = (await sql`
    SELECT tier
      FROM discovery_pre_analyses
     WHERE ticker = ${canonical}
       AND status = 'covered'
     LIMIT 1
  `) as { tier: Tier | null }[];
  const tier: Tier | null = tierRow[0]?.tier ?? fallbackTier[0]?.tier ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const priceDefault = quote?.regularMarketPrice
    ? quote.regularMarketPrice.toFixed(2)
    : "";
  const aliasNotice = canonical !== tickerInput ? tickerInput : null;

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <DashboardNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Link
          href={`/dashboard/ticker/${canonical}`}
          className="mb-6 inline-block text-sm text-navy-600 hover:text-navy-900"
        >
          &larr; Volver a la ficha
        </Link>

        <header className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
                {canonical}
              </span>
              {quote?.longName && (
                <h1 className="text-2xl font-bold text-navy-950">
                  {quote.longName}
                </h1>
              )}
              {tier && <QualityBadge tier={tier} size="sm" />}
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tracking-tight text-navy-950">
                {quote?.regularMarketPrice
                  ? `$${quote.regularMarketPrice.toFixed(2)}`
                  : "—"}
              </div>
              <p className="text-xs text-navy-500">precio actual</p>
            </div>
          </div>
          {aliasNotice && (
            <p className="mt-3 border-l-2 border-navy-300 bg-navy-50/40 px-3 py-2 text-xs italic text-navy-700">
              {aliasNotice} y {canonical} son la misma empresa, distintas
              clases de acciones. Moatboard la registra bajo {canonical}.
            </p>
          )}
        </header>

        {!isFirstBuy && (
          <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/40 px-5 py-4 text-sm text-emerald-900">
            Ya tienes <strong>{formatShares(existingShares)} acciones</strong>{" "}
            a coste medio <strong>${avgCost.toFixed(2)}</strong>
            {firstBuyDate && <> desde {formatDateEs(firstBuyDate)}</>}.
            Esta operación se sumará al historial.
          </section>
        )}

        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-xl font-bold text-navy-950">
            {isFirstBuy
              ? `Comprar ${canonical} por primera vez`
              : `Añadir más acciones de ${canonical}`}
          </h2>
          <p className="mb-5 text-sm text-navy-700">
            Al confirmar, Moatboard registra la transacción y congela un
            snapshot de la calidad y la valoración actual para poder
            compararlo en futuras revisiones mensuales.
          </p>

          <form
            action={recordBuyTransactionAction.bind(null, canonical)}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-700">
                  Precio ($)
                </span>
                <input
                  type="number"
                  name="purchase_price"
                  step="0.0001"
                  min="0.0001"
                  required
                  defaultValue={priceDefault}
                  className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-700">
                  Acciones
                </span>
                <input
                  type="number"
                  name="shares"
                  step="0.0001"
                  min="0.0001"
                  required
                  className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-700">
                  Fecha
                </span>
                <input
                  type="date"
                  name="purchase_date"
                  required
                  defaultValue={today}
                  max={today}
                  className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
                />
              </label>
            </div>

            {isFirstBuy ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-700">
                  Compromiso de salida{" "}
                  <span className="text-red-600">*</span>
                </span>
                <p className="mb-2 text-xs text-navy-500">
                  ¿Qué tendría que pasar para que dejes de creer en esta
                  inversión? Anclará tu comportamiento cuando el precio se
                  mueva.
                </p>
                <textarea
                  name="pre_commitment_md"
                  rows={4}
                  required
                  placeholder="Erosión del moat (entrantes con precio agresivo), management que destruya ROIC vía adquisiciones malas, ROIC por debajo del 12% durante dos años…"
                  className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
                />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-700">
                  Nota de esta operación (opcional)
                </span>
                <p className="mb-2 text-xs text-navy-500">
                  ¿Por qué añades hoy y no la semana pasada o la próxima?
                  El compromiso de salida de la posición se mantiene tal
                  cual.
                </p>
                <textarea
                  name="operation_note"
                  rows={2}
                  placeholder="Caída a percentil 30 de PE histórico tras guidance prudente."
                  className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
                />
              </label>
            )}

            <div className="flex flex-wrap gap-3 border-t border-navy-100 pt-5">
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Confirmar compra →
              </button>
              <Link
                href={`/dashboard/ticker/${canonical}`}
                className="rounded-lg border border-navy-300 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:border-navy-900"
              >
                Cancelar
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function formatDateEs(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatShares(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return Math.round(value).toString();
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
