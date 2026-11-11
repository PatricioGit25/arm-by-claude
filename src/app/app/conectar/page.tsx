import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { CopyBlock } from "@/components/CopyBlock";

export const dynamic = "force-dynamic";

function gmailScript(url: string) {
  return `// ARM · Conexión con Idealista (y otros portales)
// Revisa este Gmail cada minuto y envía al ARM los avisos de contacto.
const ARM_BUZON = "${url}";
const PORTALES = "from:(idealista.com OR fotocasa.es OR habitaclia.com OR pisos.com OR rightmove.co.uk OR kyero.com)";

// 1) Ejecuta "instalar" UNA vez y acepta los permisos.
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("revisarCorreo").timeBased().everyMinutes(1).create();
  // Solo se envían los avisos de la última hora en adelante (no los antiguos).
  PropertiesService.getScriptProperties().setProperty("desde", String(Date.now() - 60 * 60 * 1000));
  revisarCorreo();
}

// 2) A partir de ahí se ejecuta solo, cada minuto.
function revisarCorreo() {
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty("desde") || Date.now());
  const enviados = JSON.parse(props.getProperty("enviados") || "[]");
  GmailApp.search(PORTALES + " newer_than:2d", 0, 30).forEach(function (hilo) {
    hilo.getMessages().forEach(function (m) {
      const id = m.getId();
      if (m.getDate().getTime() < desde || enviados.indexOf(id) !== -1) return;
      const r = UrlFetchApp.fetch(ARM_BUZON, {
        method: "post", contentType: "application/json", muteHttpExceptions: true,
        payload: JSON.stringify({ from: m.getFrom(), subject: m.getSubject(), text: m.getPlainBody(), messageId: id }),
      });
      if (r.getResponseCode() < 500) enviados.push(id);
    });
  });
  props.setProperty("enviados", JSON.stringify(enviados.slice(-300)));
}
`;
}

export default async function ConnectPage() {
  const { agency } = await requireUser();
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/api/inbound/email/${agency.inboundToken}`;
  const db = await getDb();
  const received = await db.select().from(events)
    .where(and(eq(events.agencyId, agency.id), eq(events.type, "inbound_email")))
    .orderBy(desc(events.createdAt)).limit(8);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="card space-y-5 lg:col-span-3">
        <div>
          <h1 className="text-xl font-bold">Conectar Idealista</h1>
          <p className="mt-1 text-sm text-mute">
            Cada vez que Idealista (o Fotocasa, Rightmove, Kyero…) te avisa por email de un nuevo contacto, el ARM lo recibe en
            1 minuto, crea la ficha y le prepara la respuesta. Se configura una sola vez, en unos 5 minutos.
          </p>
        </div>

        <ol className="space-y-4 text-sm">
          <li>
            <p className="font-semibold">1. Entra en el Gmail donde recibes los avisos de Idealista</p>
            <p className="text-mute">Y desde esa misma cuenta abre <a className="text-arm underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → Nuevo proyecto</a>.</p>
          </li>
          <li>
            <p className="font-semibold">2. Borra lo que aparece escrito y pega esto</p>
            <div className="mt-2"><CopyBlock text={gmailScript(url)} label="Copiar programa" /></div>
          </li>
          <li>
            <p className="font-semibold">3. Guarda (💾) y ejecuta “instalar”</p>
            <p className="text-mute">Arriba, en el desplegable de funciones, elige <b>instalar</b> y pulsa <b>Ejecutar</b>.</p>
          </li>
          <li>
            <p className="font-semibold">4. Acepta los permisos</p>
            <p className="text-mute">Google pedirá permiso para leer el correo y conectarse a internet. Si dice “Google no ha verificado esta aplicación”, pulsa <b>Configuración avanzada → Ir a (proyecto)</b> y <b>Permitir</b>. Es tu propio programa, no lo ve nadie más.</p>
          </li>
          <li>
            <p className="font-semibold">5. Listo</p>
            <p className="text-mute">Desde ahora, cada aviso nuevo aparecerá en “Últimos emails recibidos” y en <Link className="text-arm underline" href="/app/leads">Leads</Link>.</p>
          </li>
        </ol>

        <div className="rounded-xl bg-panel2 p-3 text-xs text-mute">
          <p className="font-semibold text-white">¿No usáis Gmail?</p>
          <p className="mt-1">Con Outlook u otro correo: crea una regla que reenvíe los emails de Idealista a una cuenta de Gmail y sigue estos pasos en esa cuenta. También sirve cualquier servicio de correo entrante que envíe los emails a esta dirección:</p>
          <code className="mt-2 block break-all rounded-lg bg-ink p-2 text-arm">{url}</code>
          <p className="mt-2">Esta dirección es privada: quien la tenga puede crear contactos en tu cuenta.</p>
        </div>
      </section>

      <section className="card h-fit lg:col-span-2">
        <h2 className="mb-3 font-semibold">Últimos emails recibidos</h2>
        {received.length === 0 && <p className="text-sm text-mute">Todavía no ha llegado ninguno. Cuando conectes el correo, aparecerán aquí al minuto.</p>}
        <ul className="space-y-2">
          {received.map((e) => {
            const d = e.data as { ok?: boolean; subject?: string; from?: string; portal?: string; preview?: string };
            return (
              <li key={e.id} className="rounded-xl bg-panel2 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={d.ok ? "text-arm" : "text-hot"}>{d.ok ? `✓ ${d.portal ?? "Contacto creado"}` : "⚠ Sin datos de cliente"}</span>
                  <span className="shrink-0 text-xs text-mute">{e.createdAt.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <p className="mt-1 truncate text-xs text-mute">{d.subject ?? d.from ?? "(sin asunto)"}</p>
                {e.leadId && <Link className="text-xs text-arm" href={`/app/leads/${e.leadId}`}>Ver ficha →</Link>}
                {!d.ok && d.preview && (
                  <details className="mt-1 text-xs text-mute"><summary className="cursor-pointer">Ver email</summary><pre className="mt-1 whitespace-pre-wrap">{d.preview}</pre></details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
