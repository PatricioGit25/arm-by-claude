import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { agents, users, type Lang } from "@/lib/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { addAgentUserAction, changePasswordAction, saveAgentAction, updateSettingsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const team = await db.select().from(users).where(eq(users.agencyId, agency.id));
  const listingAgents = await db.select().from(agents).where(eq(agents.agencyId, agency.id));
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const days = new Set(agency.workDays.split(","));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h1 className="mb-4 text-lg font-semibold">Inmobiliaria y asistente</h1>
        <ActionForm action={updateSettingsAction} submit="Guardar">
          <div><label className="label">Nombre</label><input name="name" className="input" defaultValue={agency.name} /></div>
          <div><label className="label">Tipo de negocio</label>
            <select name="vertical" defaultValue={agency.vertical} className="input">
              <option value="venta">Inmobiliaria (venta)</option>
              <option value="vacacional">Alquiler vacacional</option>
              {agency.vertical === "comercial" && <option value="comercial">Comercial (vender el ARM)</option>}
            </select>
          </div>
          <div><label className="label">Pueblo / zona</label><input name="town" className="input" defaultValue={agency.town} /></div>
          <div><label className="label">Nombre del asistente de IA</label><input name="assistant" className="input" defaultValue={agency.assistantName} /></div>
          <div>
            <label className="label">Puntaje para pasar al equipo ({agency.handoffThreshold})</label>
            <input name="threshold" type="number" min={30} max={100} className="input" defaultValue={agency.handoffThreshold} />
            <p className="mt-1 text-xs text-mute">Más bajo = te llegan más leads, pero menos filtrados.</p>
          </div>
          <div><label className="label">WhatsApp del agente (para avisos)</label><input name="agentPhone" className="input" defaultValue={agency.agentPhone ?? ""} placeholder="+34 600 000 000" /></div>
          <div><label className="label">WhatsApp Business · phone_number_id</label><input name="waId" className="input" defaultValue={agency.waPhoneNumberId ?? ""} /></div>
          {agency.vertical !== "vacacional" && (
            <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold">📅 Agenda de visitas</legend>
              <div>
                <span className="label">Días de visitas</span>
                <div className="flex flex-wrap gap-2 text-sm">
                  {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
                    <label key={d} className="flex items-center gap-1"><input type="checkbox" name="workDays" value={i + 1} defaultChecked={days.has(String(i + 1))} /> {d}</label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label" htmlFor="workHours">Horario</label><input id="workHours" name="workHours" className="input" defaultValue={agency.workHours} placeholder="10:00-14:00,16:30-19:30" /></div>
                <div><label className="label" htmlFor="visitMinutes">Minutos por visita</label><input id="visitMinutes" name="visitMinutes" type="number" className="input" defaultValue={agency.visitMinutes} /></div>
              </div>
              <div>
                <label className="label" htmlFor="calendarIcsUrl">Tu calendario: dirección secreta en formato iCal</label>
                <input id="calendarIcsUrl" name="calendarIcsUrl" className="input" defaultValue={agency.calendarIcsUrl ?? ""} placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" />
                <p className="mt-1 text-xs text-mute">Google Calendar → ⚙️ Configuración → tu calendario → “Dirección secreta en formato iCal”. Así la IA no propone horas en las que ya estás ocupado. Si cada agente tiene su calendario, ponlo abajo en “Agentes”.</p>
              </div>
              {agency.vertical === "venta" && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="ownerApproval" defaultChecked={agency.ownerApproval} className="mt-1" />
                  <span>Las visitas necesitan el permiso del propietario<br /><span className="text-xs text-mute">La IA reserva el hueco y te avisa; al confirmarlo en la ficha, el cliente recibe la confirmación.</span></span>
                </label>
              )}
            </fieldset>
          )}
          <div>
            <label className="label" htmlFor="feedUrl">Feed XML de tu CRM (Inmovilla, Witei, Mobilia…)</label>
            <input id="feedUrl" name="feedUrl" className="input" defaultValue={agency.feedUrl ?? ""} placeholder="https://…/feed.xml" />
            <p className="mt-1 text-xs text-mute">El mismo feed que usáis para Kyero u otros portales. Las propiedades se cargan solas cada día.</p>
          </div>
          <div>
            <label className="label">Normas y preguntas frecuentes (la IA responde con esto)</label>
            <textarea name="knowledge" rows={10} className="input" defaultValue={agency.knowledge} placeholder="Horarios de check-in, mascotas, parking, cancelaciones…" />
          </div>
        </ActionForm>
      </section>

      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-2 font-semibold">Canales</h2>
          <p className="text-sm text-mute">Chat web (pon este enlace en tu web, Instagram o anuncios):</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">/chat/{agency.slug}</code>
          <p className="mt-3 text-sm text-mute">📅 Visitas del ARM en tu calendario (Google Calendar → “Otros calendarios” → “+” → “Desde URL”; en iPhone: Ajustes → Calendario → Cuentas → Añadir calendario suscrito):</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">{base}/api/calendar/{agency.calendarToken}.ics</code>
          <p className="mt-3 text-sm text-mute">Buzón para emails de portales (Idealista, Fotocasa…), privado:</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">/api/inbound/email/{agency.inboundToken}</code>
          <p className="mt-3 text-sm text-mute">Webhook de WhatsApp (Meta Cloud API):</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">/api/whatsapp</code>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Equipo</h2>
          <ul className="mb-4 space-y-1 text-sm">{team.map((u) => <li key={u.id}>{u.name} <span className="text-mute">· {u.email} · {u.role === "owner" ? "propietario" : "agente"}</span></li>)}</ul>
          <ActionForm action={addAgentUserAction} submit="Añadir agente" className="space-y-2">
            <input name="name" className="input" placeholder="Nombre" />
            <input name="email" type="email" className="input" placeholder="Email" />
            <input name="password" type="password" className="input" placeholder="Contraseña inicial (8+)" />
          </ActionForm>
        </section>
        {agency.vertical === "venta" && (
          <section className="card">
            <h2 className="font-semibold">Agentes</h2>
            <p className="mb-3 mt-0.5 text-xs text-mute">Cada visita se asigna sola: primero el agente responsable del inmueble, después quien lo captó y por último el suplente, siempre que hable el idioma del cliente, el precio esté dentro de su tope y tenga el hueco libre en su calendario. Outlook: Configuración → Calendario → Calendarios compartidos → Publicar un calendario → enlace ICS.</p>
            <div className="space-y-3">
              {listingAgents.map((a) => (
                <details key={a.id} className="rounded-xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">{a.name} <span className="font-normal text-mute">· {a.calendarIcsUrl ? "📅 calendario conectado" : "sin calendario"}{!a.doesVisits ? " · no hace visitas" : ""}{a.languages?.length ? ` · ${a.languages.join("/").toUpperCase()}` : ""}{a.maxPrice ? ` · hasta ${a.maxPrice.toLocaleString("es-ES")} €` : ""}{a.backup ? ` · suplente ${a.backupRank}` : ""}</span></summary>
                  <ActionForm action={saveAgentAction} submit="Guardar" className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input name="name" defaultValue={a.name} className="input" aria-label="Nombre" />
                    <div className="grid grid-cols-2 gap-2">
                      <input name="phone" defaultValue={a.phone ?? ""} className="input" placeholder="Teléfono (WhatsApp)" aria-label="Teléfono" />
                      <input name="email" defaultValue={a.email ?? ""} className="input" placeholder="Email" aria-label="Email" />
                    </div>
                    <input name="calendarIcsUrl" defaultValue={a.calendarIcsUrl ?? ""} className="input" placeholder="Enlace ICS de su calendario (Outlook o Google)" aria-label="Calendario" />
                    <input type="hidden" name="langsSent" value="1" />
                    <fieldset className="space-y-2 rounded-lg bg-panel2 p-2.5 text-sm">
                      <legend className="px-1 text-xs text-mute">Visitas</legend>
                      <label className="flex items-center gap-2"><input type="checkbox" name="doesVisits" defaultChecked={a.doesVisits} /> Hace visitas</label>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <span className="text-xs text-mute">Idiomas:</span>
                        {AGENT_LANGS.map(([code, label]) => (
                          <label key={code} className="flex items-center gap-1"><input type="checkbox" name="lang" value={code} defaultChecked={!a.languages?.length || a.languages.includes(code)} /> {label}</label>
                        ))}
                      </div>
                      <label className="flex items-center gap-2"><span className="text-xs text-mute">Solo inmuebles hasta</span><input name="maxPrice" inputMode="numeric" defaultValue={a.maxPrice ?? ""} className="input w-32 py-1" placeholder="sin límite" aria-label="Precio máximo" /> €</label>
                      <label className="flex items-start gap-2"><input type="checkbox" name="backup" defaultChecked={a.backup} className="mt-1" /> <span>Suplente<br /><span className="text-xs text-mute">Hace la visita cuando el agente del inmueble no habla el idioma del cliente o no está libre.</span></span></label>
                      <label className="flex items-center gap-2 pl-6"><span className="text-xs text-mute">Orden de suplente</span><input name="backupRank" type="number" min={1} max={9} defaultValue={a.backupRank} className="input w-16 py-1" aria-label="Orden de suplente" /><span className="text-xs text-mute">1 = el primero en cubrir</span></label>
                    </fieldset>
                  </ActionForm>
                </details>
              ))}
              <details className="rounded-xl border border-dashed border-line p-3">
                <summary className="cursor-pointer text-sm font-medium text-arm">+ Añadir agente</summary>
                <ActionForm action={saveAgentAction} submit="Añadir" className="mt-3 space-y-2">
                  <input name="name" className="input" placeholder="Nombre" aria-label="Nombre" />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="phone" className="input" placeholder="Teléfono (WhatsApp)" aria-label="Teléfono" />
                    <input name="email" className="input" placeholder="Email" aria-label="Email" />
                  </div>
                  <input name="calendarIcsUrl" className="input" placeholder="Enlace ICS de su calendario" aria-label="Calendario" />
                </ActionForm>
              </details>
            </div>
          </section>
        )}
        <section className="card">
          <h2 className="mb-2 font-semibold">Tu contraseña</h2>
          <ActionForm action={changePasswordAction} submit="Cambiar contraseña" className="space-y-2">
            <input name="current" type="password" autoComplete="current-password" className="input" placeholder="Contraseña actual" aria-label="Contraseña actual" />
            <input name="next" type="password" autoComplete="new-password" className="input" placeholder="Nueva contraseña (8+ caracteres)" aria-label="Nueva contraseña" />
            <input name="repeat" type="password" autoComplete="new-password" className="input" placeholder="Repite la nueva contraseña" aria-label="Repite la nueva contraseña" />
          </ActionForm>
        </section>
      </div>
    </div>
  );
}

const AGENT_LANGS: [Lang, string][] = [["es", "Español"], ["en", "Inglés"], ["sv", "Sueco"], ["de", "Alemán"], ["fr", "Francés"]];
