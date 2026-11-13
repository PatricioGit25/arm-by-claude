import Link from "next/link";
import { Logo } from "@/components/Logo";

const STEPS = [
  { n: "01", t: "Responde al momento", d: "Por WhatsApp o en tu web, a las 23:47 también. En el idioma del cliente." },
  { n: "02", t: "Pregunta lo que importa", d: "Qué busca, zona, presupuesto, plazos y financiación. Conversando, sin formularios." },
  { n: "03", t: "Agenda la visita", d: "Propone huecos libres reales de tu calendario y la deja agendada." },
  { n: "04", t: "Hace el seguimiento", d: "Día 3, día 10, día 30. Y avisa cuando entra una propiedad que encaja." },
  { n: "05", t: "Tú cierras", d: "Te pasa solo a quien va en serio, con todo resumido. Sin volver a preguntar." },
];

const FEATURES = [
  { t: "Contactos de Idealista en 1 minuto", d: "Cada aviso de Idealista, Fotocasa o Kyero entra solo, con ficha y respuesta preparada." },
  { t: "Llamadas y visitas a la oficina", d: "Dicta una frase al colgar y el ARM crea la ficha y el primer WhatsApp." },
  { t: "Tu día, ordenado", d: "A quién llamar primero, visitas de hoy y un resumen en audio cada mañana." },
  { t: "Conectado a tu CRM", d: "Lee tu catálogo del feed XML de Inmovilla, Witei, Mobilia… sin cambiar de programa." },
  { t: "Alta de propiedades por voz", d: "Sales de la visita, dictas lo que has visto y la ficha se redacta en tres idiomas." },
  { t: "Dónde se pierden los clientes", d: "Embudo diario: cuántos entran, cuántos están listos y en qué paso se caen." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo className="text-lg" />
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden rounded-full px-3 py-1.5 text-sm text-mute transition hover:text-fg sm:inline">Entrar</Link>
            <Link href="/chat/costa-nerja" className="btn">Probar la demo</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="eyebrow">Automated Relationship Manager · Inmobiliarias y alquiler vacacional</p>
            <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.2rem)] font-semibold leading-[1.02]">
              Ningún cliente sin respuesta.<br /><span className="text-mute">Ni a las 11 de la noche.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mute">
              Un asistente con IA que atiende a cada interesado al momento, lo califica, agenda la visita y le hace el seguimiento.
              Tu equipo recibe solo lo que necesita a una persona, con todo resumido.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/chat/costa-nerja" className="btn !px-5 !py-2.5">Probar como comprador</Link>
              <Link href="/chat/south-costa-demo" className="btn-ghost !px-5 !py-2.5">Probar alquiler vacacional</Link>
            </div>
            <p className="mt-6 text-sm text-mute">🇪🇸 🇬🇧 🇸🇪 🇩🇪 🇫🇷 &nbsp;Responde en el idioma de cada cliente.</p>
          </div>

          {/* Vista previa del producto */}
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-arm/15 via-transparent to-hot/10 blur-2xl" aria-hidden />
            <div className="card !p-0 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-arm to-arm2 text-xs font-semibold text-white">S</div>
                <div className="text-sm"><p className="font-semibold leading-tight">Costa Nerja Homes</p><p className="text-xs text-mute">Sofía · responde al momento</p></div>
                <span className="ml-auto text-xs tabular text-mute">23:47</span>
              </div>
              <div className="space-y-2 p-4 text-[14px]">
                <p className="ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-md bg-arm px-3 py-2 text-white">Hej! Is the Burriana apartment still available? We pay cash.</p>
                <p className="w-fit max-w-[85%] rounded-[18px] rounded-bl-md border border-line bg-panel px-3 py-2">Hi Erik! Yes 😊 NJ-101 is available: 2 beds, south terrace with sea views, €285,000. Would Saturday at 11:00 work for a viewing?</p>
                <p className="ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-md bg-arm px-3 py-2 text-white">Perfect, see you Saturday!</p>
              </div>
              <div className="m-3 rounded-xl border border-hot/25 bg-hot/10 p-3 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-hot">🔥 Listo para comprar · 92/100</p>
                <p className="mt-1">Erik L. (Suecia) · 2 dorm. en Nerja · hasta 300.000 € · contado · visita sábado 11:00</p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-line py-16 sm:py-20">
          <p className="eyebrow">Cómo funciona</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">Cinco pasos. Cuatro los hace el ARM.</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.n} className={`p-5 ${i === 4 ? "bg-arm/5" : "bg-panel"}`}>
                <p className="font-mono text-xs text-mute">{s.n}{i === 4 ? " · tú" : " · ARM"}</p>
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-mute">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line py-16 sm:py-20">
          <p className="eyebrow">Hecho para la Costa del Sol</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">Todo lo que entra, en un solo sitio. Sin apuntar nada.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.t} className="card">
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-mute">{f.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 card flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="eyebrow">También para alquiler vacacional</p>
              <h3 className="mt-2 text-xl font-semibold">Huéspedes atendidos 24/7, incidencias al momento.</h3>
              <p className="mt-1.5 text-sm text-mute">Check-in, wifi solo para huéspedes confirmados, normas, incidencias urgentes y reservas directas sin comisión de portales.</p>
            </div>
            <Link href="/chat/south-costa-demo" className="btn-ghost shrink-0">Ver la demo</Link>
          </div>
        </section>

        <section className="my-10 overflow-hidden rounded-3xl bg-fg px-6 py-14 text-center text-ink sm:px-12">
          <h2 className="text-3xl font-semibold sm:text-4xl">Míralo funcionando con tu catálogo.</h2>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">Prueba piloto de 30 días, sin permanencia. Lo configuramos con tus propiedades, tus normas y tu tono.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/chat/costa-nerja" className="inline-flex items-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-fg transition hover:opacity-90">Probar la demo</Link>
            <Link href="/login" className="inline-flex items-center rounded-full border border-ink/25 px-5 py-2.5 text-sm font-medium text-ink transition hover:border-ink/60">Ver el panel</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-mute sm:px-6">
          <Logo className="text-sm" />
          <p>Automated Relationship Manager · Nerja, Costa del Sol</p>
        </div>
      </footer>
    </div>
  );
}
