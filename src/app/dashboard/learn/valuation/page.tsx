import Link from "next/link";
import DashboardNav from "@/components/DashboardNav";

export const metadata = {
  title: "Cómo valoramos un negocio · Moatboard",
};

// Pedagogical page that explains the implied-return frame Moatboard uses
// for valuation. Written for a user with technical base but no formal
// finance training. Numerical examples grounded in real tickers from the
// dogfood portfolio. Editorial layout mirroring the rest of the product —
// long-form essay sections, no marketing flourish.

export default function LearnValuationPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <header className="mb-12">
          <Link
            href="/dashboard"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            &larr; Volver al portfolio
          </Link>
          <h1 className="mt-4 font-display text-4xl italic text-navy-950">
            Cómo valoramos un negocio
          </h1>
          <p className="mt-3 text-base leading-relaxed text-navy-600">
            La valoración es la parte más subjetiva de invertir. Esta página
            explica el marco que usa Moatboard para responder, sobre cualquier
            negocio que pase nuestro filtro de calidad, una pregunta concreta:
            si compro hoy, qué retorno puedo esperar a 10 años.
          </p>

          <nav className="mt-8 rounded-lg border border-navy-200 bg-navy-50/40 p-5 text-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
              Índice
            </div>
            <ol className="space-y-1.5 text-navy-700">
              <li>
                <a href="#pregunta" className="hover:text-navy-900">
                  1 · La pregunta que respondemos
                </a>
              </li>
              <li>
                <a href="#piezas" className="hover:text-navy-900">
                  2 · Las tres piezas del retorno
                </a>
              </li>
              <li>
                <a href="#growth" className="hover:text-navy-900">
                  3 · Cómo estimamos el crecimiento
                </a>
              </li>
              <li>
                <a href="#liston" className="hover:text-navy-900">
                  4 · Por qué no fijamos un listón
                </a>
              </li>
              <li>
                <a href="#dcf" className="hover:text-navy-900">
                  5 · Por qué no usamos DCF clásico como veredicto
                </a>
              </li>
              <li>
                <a href="#limites" className="hover:text-navy-900">
                  6 · Casos límite
                </a>
              </li>
            </ol>
          </nav>
        </header>

        <Section id="pregunta" title="1 · La pregunta que respondemos">
          <p>
            Toda decisión de inversión a largo plazo en un buen negocio se
            reduce, en última instancia, a una sola pregunta operativa:
          </p>
          <Pullquote>
            Si compro este negocio hoy y lo mantengo 10 años, ¿qué retorno
            anual puedo esperar?
          </Pullquote>
          <p>
            Esta pregunta es la que se hacen Buffett post-1985, Terry Smith,
            Chuck Akre y Nick Sleep cuando analizan una empresa. No se
            preguntan &quot;¿está barato vs algún valor intrínseco
            calculado?&quot; — esa es la pregunta del value investing
            estricto y, para compounders de calidad, casi nunca da una
            respuesta accionable.
          </p>
          <p>
            La diferencia es importante: el value investor estricto espera
            crisis profundas para entrar. El inversor en calidad a precio
            razonable (QARP) busca pagar un precio que le dé un retorno
            razonable a largo plazo, asumiendo que el negocio sigue siendo
            bueno.
          </p>
        </Section>

        <Section id="piezas" title="2 · Las tres piezas del retorno">
          <p>
            El retorno anual de mantener una acción a largo plazo se descompone
            en tres componentes (Buffett 1989, Smith 2020):
          </p>
          <Formula>
            Expected CAGR ≈ FCF Yield + Sustainable Growth + Δ Multiple
          </Formula>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            FCF Yield · el cash que el negocio te devuelve hoy
          </h3>
          <p>
            <strong>FCF Yield = Free Cash Flow / Market Cap.</strong> Es el
            porcentaje del precio que pagas hoy que el negocio te devuelve en
            cash el primer año. Es el inverso del múltiplo P/FCF: si pagas 25x
            P/FCF, tu FCF Yield es 1/25 = 4%.
          </p>
          <p>
            Es comparable directamente con alternativas. Si el Treasury 10y
            rinde 4.5%, un compounder con FCF Yield del 4% sin growth no
            compite. Pero con growth del 8% sí.
          </p>
          <Examples>
            <Example label="META · ~4.7%" detail="$70B FCF / $1.5T market cap" />
            <Example label="AAPL · ~3.0%" detail="$100B FCF / $3.4T market cap" />
            <Example label="MSFT · ~2.2%" detail="$70B FCF / $3.2T market cap" />
            <Example label="V · ~3.6%" detail="$20B FCF / $560B market cap" />
          </Examples>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            Sustainable Growth · lo que el negocio puede compounder
          </h3>
          <p>
            La tasa a la que esperas que crezca el FCF en los próximos 10 años.
            Es lo que el compounding añade encima del yield. Para un compounder
            real (ROIC alto + reinversión interna), este componente domina el
            retorno total.
          </p>
          <p>
            Estimar growth con disciplina es la parte más difícil de la
            valoración. Lo cubrimos en detalle en{" "}
            <a href="#growth" className="font-medium text-navy-700 underline">
              §3
            </a>
            .
          </p>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            Δ Multiple · la expansión o compresión del múltiplo
          </h3>
          <p>
            Si compras a 25x P/FCF y vendes a 20x en 10 años, eso te resta
            ~2.2% al año. Si compras a 20x y vendes a 25x, te suma. El múltiplo
            cambia, y ese cambio es parte del retorno realizado.
          </p>
          <p>
            Para una filosofía de buy-and-hold disciplinada, este componente
            debería ser <strong>defensivo</strong>: asumes en el caso base que
            el múltiplo se mantiene estable (Δ = 0%); en el caso de estrés
            asumes compresión hacia el Q1 histórico. Si la inversión sale
            rentable incluso con compresión, es una buena entrada. Si solo es
            rentable asumiendo expansión, estás especulando con re-rating.
          </p>
        </Section>

        <Section id="growth" title="3 · Cómo estimamos el crecimiento">
          <p>
            La fórmula matemática consensuada (Damodaran, Smith, Polen) para
            calcular el techo de crecimiento sostenible de un negocio es:
          </p>
          <Formula>Sustainable Growth = ROIC × (1 − Payout)</Formula>
          <p>
            La intuición: un negocio no puede crecer sostenido por encima de lo
            que su retorno sobre capital invertido (ROIC) × la fracción que
            reinvierte (1 − payout) le permite, sin pedir financiación externa.
            Es un techo matemático, no una opinión.
          </p>
          <Examples>
            <Example
              label="ROIC 25% × Reinversión 60%"
              detail="= 15% growth sostenible"
            />
            <Example
              label="ROIC 15% × Reinversión 100%"
              detail="= 15% growth (todo retenido)"
            />
            <Example
              label="ROIC 25% × Reinversión 30%"
              detail="= 7.5% growth (paga muchos dividendos)"
            />
          </Examples>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            Las dos anclas que cruzamos
          </h3>
          <p>
            Moatboard calcula dos anclas para cada negocio y toma la menor de
            las dos como caso base:
          </p>
          <ul className="space-y-2 text-navy-700">
            <li>
              <strong>Histórico:</strong> el CAGR de revenue (o AFFO/share para
              REITs) de los últimos 10 años. Lo que el negocio realmente hizo —
              el track record manda.
            </li>
            <li>
              <strong>Fundamental sostenible:</strong> ROIC × retención (o ROE
              × retención para bancos, ROA × retención para REITs). Lo que la
              matemática del negocio soporta.
            </li>
          </ul>
          <p>
            <strong>Tomamos la menor de las dos.</strong> Es la disciplina de
            Smith aplicada literalmente: nunca extrapolar growth por encima de
            lo que el track record o la matemática soportan. Si el histórico
            dice 15% pero la fórmula dice 8%, asumimos 8%. Si el histórico es
            8% pero la fórmula dice 12%, asumimos 8%.
          </p>
          <p>
            Adicionalmente, capamos cualquier resultado al 20% — ningún negocio
            sostiene crecimiento superior al 20% durante 10 años (Buffett dixit,
            datos S&P confirman).
          </p>
          <p>
            Para el escenario de estrés, multiplicamos el growth base × 0.7
            (cushion del 30% para errores de assumption, recesiones, regime
            changes).
          </p>
        </Section>

        <Section id="liston" title="4 · Por qué no fijamos un listón">
          <p>
            Versiones anteriores de Moatboard imponían un veredicto binario
            (&quot;comprable / no comprable&quot;) basado en umbrales fijos
            por tier de calidad: 12% para excepcional, 14% para good, 17%
            para mediocre. Lo retiramos.
          </p>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            La razón: el listón es subjetivo
          </h3>
          <p>
            Qué retorno hace que un negocio sea comprable depende de dos
            cosas que el framework no puede saber por ti:
          </p>
          <ul className="space-y-2 text-navy-700">
            <li>
              <strong>Tu coste de oportunidad.</strong> Si tu alternativa
              real son letras del Tesoro al 4.5%, un compounder excepcional
              al 8% esperado puede ser perfectamente atractivo. Si tu
              alternativa son fondos indexados al 9-10% histórico, exigirás
              algo más. Si tu alternativa son private deals que tienes
              identificados al 18%, ningún equity compounder pasa el filtro.
            </li>
            <li>
              <strong>Tu convicción en el negocio.</strong> Un 14% esperado
              en una empresa cuya tesis entiendes profundamente y cuyo moat
              has estudiado años no es lo mismo que un 14% en una empresa
              que acabas de descubrir. La varianza percibida cambia el
              listón aceptable.
            </li>
          </ul>

          <h3 className="mt-6 font-display text-lg italic text-navy-900">
            Lo que mostramos en su lugar
          </h3>
          <p>
            Moatboard te entrega tres números y una referencia, y deja
            la decisión en tu mano:
          </p>
          <ul className="space-y-2 text-navy-700">
            <li>
              <strong>Caso base · CAGR esperado.</strong> Lo que el negocio
              probablemente devolverá si las asunciones de growth y múltiplo
              se cumplen.
            </li>
            <li>
              <strong>Caso estresado · CAGR.</strong> Growth × 0.7 +
              compresión del múltiplo a Q1 histórico. El escenario malo
              creíble.
            </li>
            <li>
              <strong>Caso optimista · CAGR.</strong> FCF Yield + crecimiento
              completo, asumiendo el múltiplo estable. Para contextualizar.
            </li>
            <li>
              <strong>Treasury 10y + 2% como referencia.</strong> No es un
              gate, es un dato: el bono soberano más una prima de equity
              modesta. Si el caso estresado cae por debajo, sabes que estás
              asumiendo riesgo equity para retornos similares al cash. Tú
              decides si esa asimetría te compensa.
            </li>
          </ul>

          <p className="mt-6">
            El frame sigue siendo Buffett: <em>Rule No. 1: Never lose
            money.</em> Pero la traducción operativa es que tú definas qué
            significa &quot;atractivo&quot; y qué significa
            &quot;desastre&quot; para tu cartera y tu coste de oportunidad —
            no Moatboard.
          </p>

          <ExampleTable />
        </Section>

        <Section id="dcf" title="5 · Por qué no usamos DCF clásico como veredicto">
          <p>
            El Discounted Cash Flow descuenta los flujos de caja futuros del
            negocio a una tasa &quot;hurdle&quot; (típicamente 10-14%) y los
            compara con el precio. Si el resultado (intrinsic value) está por
            encima del precio actual, el negocio &quot;cotiza barato&quot;; si
            está por debajo, &quot;cotiza caro&quot;.
          </p>
          <p>
            El problema con DCF estricto para QARP: con tasas de descuento del
            10-14%, un negocio con ROIC del 25% que reinvierte internamente a
            tasas similares <strong>nunca</strong> cotiza barato según el
            modelo. Es matemáticamente correcto y comercialmente inútil para
            quien busca calidad a precio razonable.
          </p>
          <p>
            Buffett mismo pagó 25x por See&apos;s en 1972 y 25x+ por Apple en
            2016 — si su propio framework de owner earnings con descuento al
            10% lo hubiera frenado, no habría hecho ninguna de las dos.
          </p>
          <p>
            Por eso, en Moatboard, el DCF (y los métodos hermanos AFFO,
            Excess Returns) viven como{" "}
            <strong>cross-check secundario</strong> en la sección
            &quot;Otros métodos&quot; de la pantalla de valoración. Útiles
            para detectar precios absurdos (cuando el DCF dice que el
            mercado pide growth del 30% durante 10 años para justificar el
            precio actual, eso es señal). No útiles como veredicto de
            entrada.
          </p>
          <p>
            La pregunta que el DCF sí responde bien:{" "}
            <em>
              ¿qué growth implícito está pidiendo el mercado al precio actual?
            </em>{" "}
            Si la respuesta es razonable, comprable. Si es absurda, pasar.
            Eso es DCF reverso, al estilo Polen Capital.
          </p>
        </Section>

        <Section id="limites" title="6 · Casos límite">
          <h3 className="mt-2 font-display text-lg italic text-navy-900">
            Compounders post-IPO con runway expansion
          </h3>
          <p>
            Empresas como KNSL (Kinsale Capital) tienen historiales limitados
            (3-5 años) y growth alto (25%+) que parece replicable. La fórmula
            fundamental puede dar números altos. <strong>Cap del 20%</strong>{" "}
            limita la asunción a algo realista, alineado con el techo
            histórico de cualquier negocio.
          </p>

          <h3 className="mt-4 font-display text-lg italic text-navy-900">
            Empresas en transición
          </h3>
          <p>
            META post-Reels, GOOG con capex AI: histórico alto pero ROIC
            reciente comprimido. La fórmula fundamental usa el ROIC mediano
            (10y), capturando la transición de forma automática sin necesidad
            de ajustes manuales.
          </p>

          <h3 className="mt-4 font-display text-lg italic text-navy-900">
            Mature stable compounders
          </h3>
          <p>
            KO, PG, V: histórico y fundamental convergen. Sin sobresaltos.
          </p>

          <h3 className="mt-4 font-display text-lg italic text-navy-900">
            Negocios que el framework no cubre
          </h3>
          <p>
            Cíclicos, commodity producers, biotecnológicas, y cualquier
            negocio con menos de 5 dimensiones aplicables del scorecard, son
            bloqueados por la gate &quot;Moatboard can&apos;t analyze this
            business&quot; antes de llegar a valoración. Para ellos, el
            framework no aplica.
          </p>
        </Section>

        <footer className="mt-16 border-t border-navy-200 pt-8 text-sm text-navy-500">
          <p>
            Esta página describe el marco mental de Moatboard. La aplicación
            práctica vive en la sección Valoración de cada empresa de tu
            cartera o watchlist. Si después de leerla algo no encaja, esa
            fricción es señal — el marco se afinará con tu uso real.
          </p>
        </footer>
      </main>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-8">
      <h2 className="mb-4 font-display text-2xl italic text-navy-950">
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed text-navy-700">
        {children}
      </div>
    </section>
  );
}

function Pullquote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="my-5 border-l-4 border-navy-400 bg-navy-50/50 px-5 py-3 font-display text-lg italic leading-relaxed text-navy-800">
      {children}
    </blockquote>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-md border border-navy-200 bg-navy-50/50 px-5 py-3 text-center font-mono text-sm text-navy-900">
      {children}
    </div>
  );
}

function Examples({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 grid gap-2 rounded-md border border-navy-100 bg-navy-50/40 p-4 sm:grid-cols-2">
      {children}
    </div>
  );
}

function Example({ label, detail }: { label: string; detail: string }) {
  return (
    <div>
      <div className="text-sm font-medium text-navy-900">{label}</div>
      <div className="text-xs text-navy-500">{detail}</div>
    </div>
  );
}

function ExampleTable() {
  return (
    <div className="my-5 overflow-x-auto rounded-md border border-navy-200">
      <table className="w-full text-sm">
        <thead className="bg-navy-50 text-[11px] uppercase tracking-wider text-navy-600">
          <tr>
            <th className="px-3 py-2 text-left">Negocio</th>
            <th className="px-3 py-2 text-right">Base</th>
            <th className="px-3 py-2 text-right">Stress</th>
            <th className="px-3 py-2 text-right">Floor de referencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100 tabular-nums text-navy-800">
          <tr>
            <td className="px-3 py-2">META · Exceptional</td>
            <td className="px-3 py-2 text-right">12.7%</td>
            <td className="px-3 py-2 text-right">11.2%</td>
            <td className="px-3 py-2 text-right text-navy-500">7%</td>
          </tr>
          <tr>
            <td className="px-3 py-2">MSFT · Exceptional</td>
            <td className="px-3 py-2 text-right">12.2%</td>
            <td className="px-3 py-2 text-right">10.7%</td>
            <td className="px-3 py-2 text-right text-navy-500">7%</td>
          </tr>
          <tr>
            <td className="px-3 py-2">INTU · Exceptional</td>
            <td className="px-3 py-2 text-right">13.0%</td>
            <td className="px-3 py-2 text-right">~11%</td>
            <td className="px-3 py-2 text-right text-navy-500">7%</td>
          </tr>
          <tr>
            <td className="px-3 py-2">KNSL · Exceptional</td>
            <td className="px-3 py-2 text-right">~20%</td>
            <td className="px-3 py-2 text-right">~16%</td>
            <td className="px-3 py-2 text-right text-navy-500">7%</td>
          </tr>
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] italic text-navy-500">
        Sin columna de veredicto: si el listón aceptable para ti es 10%,
        los cuatro pasan; si es 15%, solo KNSL pasa. Tú decides el listón.
      </p>
    </div>
  );
}
