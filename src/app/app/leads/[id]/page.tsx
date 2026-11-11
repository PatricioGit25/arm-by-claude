import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { events, leads, messages, properties, visits, type Stage } from "@/lib/db/schema";
import { formatPrice, propertyMatches, scoreLead, stageLabel, stagesFor } from "@/lib/scoring";
import { LANG_FLAG, LANG_LABEL } from "@/lib/i18n";
import { ScoreBar, StageBadge } from "@/components/StageBadge";
import { agentReplyAction, confirmVisitAction, markGuestAction, setStageAction, toggleAiAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  lead_created: "Entró el lead", profile_updated: "La IA actualizó la ficha", stage_changed: "Cambio de etapa",
  handoff: "Pasado al agente", visit_requested: "Pidió visita", followup_sent: "Seguimiento automático",
  property_match: "Aviso de propiedad nueva", ai_paused: "IA pausada", ai_resumed: "IA reactivada", send_failed: "Error de envío",
  incident: "Incidencia reportada", guest_marked: "Marcado como huésped",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { agency } = await requireUser();
  const db = await getDb();
  const lead = (await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.agencyId, agency.id))))[0];
  if (!lead) notFound();

  const [msgs, evs, vis, catalog] = await Promise.all([
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.createdAt)),
    db.select().from(events).where(eq(events.leadId, id)).orderBy(desc(events.createdAt)).limit(30),
    db.select().from(visits).where(eq(visits.leadId, id)).orderBy(desc(visits.createdAt)),
    db.select().from(properties).where(eq(properties.agencyId, agency.id)),
  ]);
  const p = lead.profile;
  const vertical = agency.vertical;
  const vacation = vertical === "vacacional";
  const { reasons } = scoreLead(p, { inboundCount: lead.inboundCount, hasContact: !!(lead.phone || lead.email) }, vertical);
  const matches = catalog.filter((x) => propertyMatches(x, p, vertical)).slice(0, 4);
  const guestOf = catalog.find((c) => c.id === lead.guestPropertyId);
  const interest = catalog.find((c) => c.ref === p.property_ref);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <Link href="/app/leads" className="text-sm text-mute hover:text-white">← Pipeline</Link>
        <section className="card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">{lead.name ?? "Sin nombre"}</h1>
              <p className="text-sm text-mute">{LANG_FLAG[lead.language]} {LANG_LABEL[lead.language]} · {lead.source ?? lead.channel}</p>
            </div>
            <StageBadge stage={lead.stage} vertical={vertical} />
          </div>
          <div className="mt-3"><ScoreBar score={lead.score} threshold={agency.handoffThreshold} /></div>
          {lead.summary && (
            <div className="mt-4 rounded-xl border border-hot/30 bg-hot/10 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-hot">Resumen para el equipo</p>
              {lead.summary}
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Field k="Teléfono" v={lead.phone} /><Field k="Email" v={lead.email} />
            {vacation ? (
              <>
                <Field k="Llegada" v={p.check_in} /><Field k="Salida" v={p.check_out} />
                <Field k="Personas" v={p.guests ? String(p.guests) : undefined} /><Field k="Mascota" v={p.pets === undefined ? undefined : p.pets ? "Sí" : "No"} />
                <Field k="Le interesa" v={interest?.title ?? p.property_ref} /><Field k="Quiere reservar" v={p.wants_booking ? "Sí" : undefined} />
                <Field k="Huésped de" v={guestOf?.title} /><Field k="Presupuesto/noche" v={p.budget_night ? formatPrice(p.budget_night) : undefined} />
              </>
            ) : (
              <>
                <Field k="Tipo" v={p.property_type} /><Field k="Dormitorios" v={p.bedrooms_min ? `${p.bedrooms_min}+` : undefined} />
                <Field k="Presupuesto" v={p.budget_max ? formatPrice(p.budget_max) : undefined} /><Field k="Zona" v={p.zones?.join(", ")} />
                <Field k="Plazo" v={p.timeline_months !== undefined ? `${p.timeline_months} meses` : undefined} /><Field k="Financiación" v={p.financing?.replace("_", " ")} />
                <Field k="Para" v={p.purpose} /><Field k="Quiere visitar" v={p.wants_visit ? "Sí" : undefined} />
              </>
            )}
          </dl>
          {p.notes && <p className="mt-3 text-sm text-mute">📝 {p.notes}</p>}
          <details className="mt-3 text-xs text-mute"><summary className="cursor-pointer">¿Por qué este puntaje?</summary><ul className="mt-1 list-disc pl-4">{reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
        </section>

        <section className="card space-y-3">
          <form action={setStageAction} className="flex gap-2">
            <input type="hidden" name="id" value={lead.id} />
            <select name="stage" defaultValue={lead.stage} className="input">
              {stagesFor(vertical).map((s) => <option key={s} value={s}>{stageLabel(s, vertical)}</option>)}
            </select>
            <button className="btn-ghost">Mover</button>
          </form>
          <form action={toggleAiAction}>
            <input type="hidden" name="id" value={lead.id} />
            <input type="hidden" name="paused" value={lead.aiPaused ? "0" : "1"} />
            <button className={lead.aiPaused ? "btn w-full" : "btn-ghost w-full"}>
              {lead.aiPaused ? "Devolver la conversación a la IA" : "Tomar yo la conversación (pausar IA)"}
            </button>
          </form>
          {vacation && (
            <form action={markGuestAction} className="space-y-2 border-t border-line pt-3">
              <input type="hidden" name="id" value={lead.id} />
              <label className="label" htmlFor="guest-property">Huésped confirmado de</label>
              <div className="flex gap-2">
                <select id="guest-property" name="propertyId" defaultValue={lead.guestPropertyId ?? ""} className="input">
                  <option value="">— No es huésped —</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button className="btn-ghost">Guardar</button>
              </div>
              <p className="text-xs text-mute">Solo los huéspedes confirmados reciben de la IA los códigos de acceso y el wifi.</p>
            </form>
          )}
        </section>

        {vis.length > 0 && (
          <section className="card">
            <h2 className="mb-2 font-semibold">Visitas</h2>
            {vis.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 border-t border-line py-2 text-sm first:border-0">
                <div>
                  <p>{catalog.find((c) => c.id === v.propertyId)?.ref ?? "Propiedad por definir"} · {v.preferredTime}</p>
                  <p className="text-xs text-mute">{v.status}</p>
                </div>
                {v.status === "pendiente" && (
                  <form action={confirmVisitAction}>
                    <input type="hidden" name="id" value={v.id} /><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="status" value="confirmada" />
                    <button className="btn">Confirmar</button>
                  </form>
                )}
              </div>
            ))}
          </section>
        )}

        {matches.length > 0 && !guestOf && (
          <section className="card">
            <h2 className="mb-2 font-semibold">{vacation ? "Alojamientos que encajan" : "Propiedades que encajan"}</h2>
            {matches.map((m) => <p key={m.id} className="border-t border-line py-2 text-sm first:border-0">{m.ref} · {m.title} · <span className="text-arm">{vacation ? `${m.maxGuests} pers.` : formatPrice(m.price)}</span></p>)}
          </section>
        )}

        <section className="card">
          <h2 className="mb-2 font-semibold">Historial automático</h2>
          <ul className="space-y-2 text-sm">
            {evs.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{EVENT_LABEL[e.type] ?? e.type}{e.type === "stage_changed" ? `: ${stageLabel(e.data.to as Stage, vertical)}` : ""}</span>
                <span className="shrink-0 text-xs text-mute">{e.createdAt.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card flex h-[80vh] flex-col lg:col-span-3">
        <h2 className="mb-3 font-semibold">Conversación <span className="text-xs font-normal text-mute">({lead.aiPaused ? "la llevas tú" : "la lleva la IA"})</span></h2>
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.direction === "in" ? "bg-panel2" : m.author === "agent" ? "bg-sky-500/20" : "bg-arm/15"}`}>
                {m.body}
                <p className="mt-1 text-[10px] text-mute">{m.author === "ai" ? "IA" : m.author === "agent" ? "Agente" : ""} {m.createdAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          ))}
        </div>
        <form action={agentReplyAction} className="mt-3 flex gap-2">
          <input type="hidden" name="id" value={lead.id} />
          <input name="body" className="input" placeholder="Escribir como agente…" autoComplete="off" />
          <button className="btn">Enviar</button>
        </form>
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-mute">{k}</dt>
      <dd className={v ? "" : "text-mute"}>{v ?? "—"}</dd>
    </div>
  );
}
