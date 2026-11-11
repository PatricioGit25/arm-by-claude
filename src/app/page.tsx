import Link from "next/link";
import { Logo } from "@/components/Logo";

const STEPS = [
  { t: "Contesta a todos, 24/7", d: "A las 11:47 de la noche también. Por WhatsApp, web o portales, en español, inglés y sueco." },
  { t: "Pregunta lo que importa", d: "Qué busca, presupuesto, zona, plazo y financiación, conversando con naturalidad." },
  { t: "Separa curiosos de compradores", d: "Puntaje de 0 a 100. Los fríos van a seguimiento; los calientes, al vendedor." },
  { t: "Pasa el lead con todo resumido", d: "“Listo para comprar · Apartamento 2 hab · hasta 180 mil · diciembre”. Sin volver a preguntar." },
  { t: "Hace el seguimiento solo", d: "Día 3, día 10, día 30… y avisa cuando entra una propiedad que encaja." },
  { t: "Te dice dónde se caen", d: "Resumen de la mañana: cuántos entraron, cuántos están listos y en qué paso se pierden." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav className="flex items-center justify-between">
        <Logo className="text-2xl" />
        <div className="flex gap-2">
          <Link href="/login" className="btn-ghost">Entrar</Link>
          <Link href="/signup" className="btn">Crear inmobiliaria</Link>
        </div>
      </nav>

      <section className="py-20 text-center">
        <p className="chip mx-auto mb-6 border-arm/40 text-arm">Automated Relationship Manager</p>
        <h1 className="text-4xl font-black leading-tight sm:text-6xl">
          Tu CRM no le contesta a nadie<br />a las 11 de la noche.<br />
          <span className="text-arm">El ARM, sí.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-mute">
          Agentes de IA que atienden a cada comprador potencial, lo califican y te pasan solo a los que de verdad
          van a comprar. Tú no apuntas nada: todo queda registrado solo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/chat/costa-nerja" className="btn">Probar el chat como comprador</Link>
          <Link href="/login" className="btn-ghost">Ver el panel demo</Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.t} className="card">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-arm/15 text-sm font-bold text-arm">{i + 1}</div>
            <h3 className="font-semibold">{s.t}</h3>
            <p className="mt-1 text-sm text-mute">{s.d}</p>
          </div>
        ))}
      </section>

      <footer className="py-12 text-center text-xs text-mute">ARM by Claude · Multi-inmobiliaria · 🇪🇸 🇬🇧 🇸🇪</footer>
    </main>
  );
}
