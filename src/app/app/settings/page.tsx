import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { addAgentUserAction, updateSettingsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const team = await db.select().from(users).where(eq(users.agencyId, agency.id));
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
          {agency.vertical === "venta" && (
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
                <p className="mt-1 text-xs text-mute">Google Calendar → ⚙️ Configuración → tu calendario → “Dirección secreta en formato iCal”. Así la IA no propone horas en las que ya estás ocupado.</p>
              </div>
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
      </div>
    </div>
  );
}
