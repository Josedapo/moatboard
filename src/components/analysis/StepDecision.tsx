import {
  decideInvestAction,
  decideWatchlistAction,
  decideDiscardAction,
} from "@/app/dashboard/analyze/[ticker]/actions";

export default function StepDecision({ ticker }: { ticker: string }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-bold text-navy-950">
          Invest
        </h2>
        <p className="mb-4 text-sm text-navy-700">
          Record the buy. A snapshot of the full quality + valuation picture
          at this moment will be frozen so you can compare against it in every
          future review.
        </p>
        <form action={decideInvestAction.bind(null, ticker)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="purchase_price"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Purchase price ($)
              </label>
              <input
                id="purchase_price"
                name="purchase_price"
                type="number"
                step="0.0001"
                min="0"
                required
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="shares"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Shares
              </label>
              <input
                id="shares"
                name="shares"
                type="number"
                step="0.0001"
                min="0"
                required
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="purchase_date"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Purchase date
              </label>
              <input
                id="purchase_date"
                name="purchase_date"
                type="date"
                required
                defaultValue={today}
                max={today}
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none sm:max-w-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="position_pre_commitment"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Compromiso de salida (opcional)
              </label>
              <p className="mb-2 text-xs text-navy-500">
                ¿Qué tendría que pasar para que dejes de creer en esta
                inversión? Anclará tu comportamiento cuando el precio se
                mueva. Puedes dejarlo en blanco y añadirlo después desde la
                ficha.
              </p>
              <textarea
                id="position_pre_commitment"
                name="position_pre_commitment"
                rows={5}
                placeholder="Erosión del moat (entrantes con precio agresivo), management que destruya ROIC vía adquisiciones malas, CEO sustituido sin continuidad clara, ROIC por debajo del 12% durante dos años…"
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="operation_note"
                className="mb-1 block text-sm font-medium text-navy-700"
              >
                Nota de esta compra (opcional)
              </label>
              <p className="mb-2 text-xs text-navy-500">
                ¿Por qué compras hoy y no la semana pasada o la próxima?
              </p>
              <textarea
                id="operation_note"
                name="operation_note"
                rows={2}
                placeholder="Caída a percentil 30 de PE histórico tras guidance prudente."
                className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Invest in {ticker}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-bold text-navy-950">Watchlist</h2>
        <p className="mb-4 text-sm text-navy-700">
          Parked with a specific reason and a trigger for when to revisit.
          Avoids a dead-cajón list that grows and never gets reviewed.
        </p>
        <form action={decideWatchlistAction.bind(null, ticker)}>
          <div>
            <label
              htmlFor="watchlist_reason"
              className="mb-1 block text-sm font-medium text-navy-700"
            >
              Razonamiento y cuándo revisar
            </label>
            <p className="mb-2 text-xs text-navy-500">
              ¿Por qué la aparcas y qué tendría que pasar para que la retomes?
              Todo en un mismo texto — el trigger de revisión es parte del
              razonamiento.
            </p>
            <textarea
              id="watchlist_reason"
              name="reason"
              rows={5}
              required
              minLength={5}
              placeholder="Calidad fuerte pero P/E en percentil 92 de su propia historia. Revisamos tras earnings de Q2 2026, o cuando el percentil caiga por debajo de 50."
              className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="mt-5 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Add {ticker} to watchlist
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-bold text-navy-950">Discard</h2>
        <p className="mb-4 text-sm text-navy-700">
          Move on, but record why. If this ticker comes back into the funnel
          in the future, Moatboard will remind you of this reason so you
          don&apos;t re-analyze blindly.
        </p>
        <form action={decideDiscardAction.bind(null, ticker)}>
          <div>
            <label
              htmlFor="discard_reason"
              className="mb-1 block text-sm font-medium text-navy-700"
            >
              Reason
            </label>
            <textarea
              id="discard_reason"
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="Quality mediocre, D/E too high, sector I don't follow closely enough…"
              className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="mt-5 rounded-lg bg-red-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-800"
          >
            Discard {ticker}
          </button>
        </form>
      </section>
    </div>
  );
}
