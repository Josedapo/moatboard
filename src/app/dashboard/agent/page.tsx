// Iris — la única operadora del observatorio.
//
// Página dedicada que reúne todo lo que el sistema hace en background:
// escaneo diario de SEC EDGAR, revisión semanal de 13F, refresh de
// análisis tras nuevo 10-K / 10-Q, snapshot trimestral, propagación de
// tier a per-user. Iris es la persona ficticia que personifica todo
// ese trabajo para el usuario.
//
// Estructura:
//   - Hero card: avatar "I", nombre, rol, descripción larga editorial
//     que explica qué hace en castellano llano.
//   - Heartbeats: dos paneles compactos con la última y próxima
//     ejecución de cada job (daily SEC + weekly 13F).
//   - Manual invoke buttons: dos botones para disparar cada job ad-hoc.
//   - Action log: bitácora de las últimas 50 acciones con dos pestañas
//     (Tus tickers · Todo Moatboard).

import { auth } from "@/auth";
import { listRecentIrisActions } from "@/lib/irisActions";
import DashboardNav from "@/components/DashboardNav";
import IrisActionLog from "@/components/agent/IrisActionLog";

export const metadata = {
  title: "Agente · Moatboard",
};

export default async function AgentPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [userActions, allActions] = await Promise.all([
    listRecentIrisActions({ userId: session.user.id, limit: 50, scope: "user" }),
    listRecentIrisActions({ limit: 50, scope: "all" }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <header className="mb-10">
          <h1 className="font-display text-3xl font-semibold text-navy-950">
            Agente
          </h1>
          <p className="mt-2 text-navy-600">
            Iris es el agente encargado de que el observatorio funcione mientras
            tú estás haciendo otra cosa: lee filings, refresca análisis, congela
            snapshots, vigila a los gestores que sigue Moatboard. Aquí ves quién
            es y todo lo que ha hecho últimamente.
          </p>
        </header>

        {/* Hero card: Iris */}
        <section className="mb-8 rounded-2xl border border-navy-100 bg-white p-7 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-navy-900 font-display text-3xl font-semibold text-white">
              I
            </div>
            <div className="flex-1">
              <h2 className="font-display text-2xl font-semibold text-navy-950">
                Iris
              </h2>
              <p className="mt-1 text-sm italic text-navy-600">
                Operadora del observatorio
              </p>
              <div className="mt-5 space-y-3 text-sm leading-relaxed text-navy-700">
                <p>
                  <strong>Cada mañana</strong> revisa SEC EDGAR para todos los
                  tickers que están en cartera o watchlist de algún usuario.
                  Cuando aparece un 10-Q, 10-K o un 8-K relevante (cambio de
                  directivos, restatement, fusión, evento material), lo deja
                  como señal en el Inbox de los usuarios afectados. Rastrea
                  también las compras de insiders (Form 4) sobre esas mismas
                  empresas.
                </p>
                <p>
                  <strong>Cuando llega un 10-K nuevo</strong> de un ticker,
                  recalcula calidad, vuelve a evaluar el moat con el filing
                  fresco, extrae las nuevas red flags, reescribe el resumen del
                  negocio y recalcula la valoración de cada ficha que tenga
                  ese ticker (FCF TTM y distribuciones de múltiplos vienen del
                  nuevo filing; tus overrides manuales de growth y múltiplo
                  terminal se preservan). La calidad fresca se propaga
                  automáticamente a los análisis personales de quien lo tenga
                  en cartera.
                </p>
                <p>
                  <strong>Cuando llega un 10-Q</strong> recalcula el scorecard
                  y la valoración con los números trimestrales frescos. Se
                  mantiene el MOAT del último 10-K, las red flags también y
                  la guía de valoración. Si el tier cambia, lo propaga a los
                  análisis personales y emite una señal de cambio material en
                  el Inbox.
                </p>
                <p>
                  <strong>Cada lunes</strong> recorre todos los fondos curados
                  que Moatboard sigue y comprueba si han presentado un 13F
                  nuevo. Cuando aparece, lo parsea, actualiza el leaderboard
                  de Discovery, y avisa en el Inbox si alguno de los tickers
                  que sigues ha entrado, salido o cambiado de peso
                  significativo en la cartera de un fondo.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Action log */}
        <IrisActionLog userActions={userActions} allActions={allActions} />
      </main>
    </div>
  );
}
