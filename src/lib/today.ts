/**
 * "Tu día": lo que el equipo tiene que hacer hoy, priorizado, y un resumen
 * hablado (texto que se puede convertir en audio).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { leads, messages, properties, visits, type Agency, type Lead } from "./db/schema";
import { localParts, zoned } from "./calendar";
import { formatPrice, propertyMatches } from "./scoring";

export type TodayKind = "visit" | "confirm" | "hot" | "incident" | "send" | "match" | "revive" | "complete";
export interface TodayItem {
  kind: TodayKind;
  priority: number;
  title: string;
  detail: string;
  href: string;
  time?: string;
  phone?: string | null;
}

const DAY = 86_400_000;
const firstName = (l: Lead) => l.name?.split(" ")[0] ?? "cliente sin nombre";

export async function buildToday(agency: Agency, now = new Date()) {
  const db = await getDb();
  const tz = agency.timezone;
  const lp = localParts(now, tz);
  const dayStart = zoned(lp.y, lp.m, lp.d, 0, 0, tz);
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const [allLeads, allVisits, props, agentMsgs] = await Promise.all([
    db.select().from(leads).where(eq(leads.agencyId, agency.id)),
    db.select().from(visits).where(and(eq(visits.agencyId, agency.id), inArray(visits.status, ["pendiente", "agendada", "confirmada"]))),
    db.select().from(properties).where(eq(properties.agencyId, agency.id)),
    db.select({ leadId: messages.leadId, createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.agencyId, agency.id), eq(messages.author, "agent"), gte(messages.createdAt, new Date(now.getTime() - 14 * DAY))))
      .orderBy(desc(messages.createdAt)),
  ]);
  const leadById = new Map(allLeads.map((l) => [l.id, l]));
  const propById = new Map(props.map((p) => [p.id, p]));
  const lastAgentMsg = new Map<string, Date>();
  for (const m of agentMsgs) if (!lastAgentMsg.has(m.leadId)) lastAgentMsg.set(m.leadId, m.createdAt);
  const time = (d: Date) => d.toLocaleTimeString("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const items: TodayItem[] = [];

  for (const v of allVisits) {
    const lead = leadById.get(v.leadId);
    if (!lead) continue;
    const prop = v.propertyId ? propById.get(v.propertyId) : undefined;
    const sales = agency.vertical === "comercial";
    const where = sales ? (lead.profile.company ?? "agencia por confirmar") : prop ? `${prop.ref} · ${prop.title}` : "propiedad por definir";
    const what = sales ? "demo" : "visita";
    if (v.scheduledAt && v.scheduledAt >= dayStart && v.scheduledAt < dayEnd) {
      items.push({ kind: "visit", priority: 1, time: time(v.scheduledAt), title: `${sales ? "Demo" : "Visita"} con ${lead.name ?? "cliente"}`, detail: where, href: `/app/leads/${lead.id}`, phone: lead.phone });
    } else if (v.status === "agendada" || v.status === "pendiente") {
      const when = v.scheduledAt ? v.scheduledAt.toLocaleString("es-ES", { timeZone: tz, weekday: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "sin hora";
      items.push({ kind: "confirm", priority: 3, title: `Confirmar ${what} de ${lead.name ?? "cliente"}`, detail: `${when} · ${where}`, href: `/app/leads/${lead.id}`, phone: lead.phone });
    }
  }

  for (const l of allLeads) {
    const contacted = lastAgentMsg.get(l.id);
    if (l.stage === "incidencia") {
      items.push({ kind: "incident", priority: 0, title: `Resolver incidencia de ${l.name ?? "huésped"}`, detail: l.summary ?? "", href: `/app/leads/${l.id}`, phone: l.phone });
    } else if (l.stage === "listo" && (!contacted || (l.handedOffAt && contacted < l.handedOffAt))) {
      items.push({
        kind: "hot", priority: 2, title: `Llamar a ${l.name ?? "cliente"} (${l.score}/100)`,
        detail: l.summary ?? (agency.vertical === "vacacional" ? "Quiere reservar" : agency.vertical === "comercial" ? "Quiere hablar del ARM" : "Listo para comprar"), href: `/app/leads/${l.id}`, phone: l.phone,
      });
    } else if ((l.channel === "portal" || l.channel === "manual") && !contacted && l.createdAt > new Date(now.getTime() - 3 * DAY) && !["perdido", "cerrado"].includes(l.stage)) {
      items.push({ kind: "send", priority: 4, title: `Enviar el WhatsApp preparado a ${l.name ?? "cliente"}`, detail: `Entró por ${l.source ?? l.channel}`, href: `/app/leads/${l.id}`, phone: l.phone });
    } else if (l.stage === "calificando" && l.score >= 40 && l.lastInboundAt && l.lastInboundAt < new Date(now.getTime() - 5 * DAY) && !l.aiPaused) {
      items.push({ kind: "revive", priority: 6, title: `Retomar a ${l.name ?? "cliente"}`, detail: `Sin respuesta desde hace ${Math.round((now.getTime() - l.lastInboundAt.getTime()) / DAY)} días · ${l.score}/100`, href: `/app/leads/${l.id}`, phone: l.phone });
    }
  }

  const recentProps = props.filter((p) => p.status === "disponible" && p.createdAt > new Date(now.getTime() - 2 * DAY));
  const matches = recentProps
    .map((p) => ({ p, fits: allLeads.filter((l) => ["calificando", "seguimiento", "listo"].includes(l.stage) && propertyMatches(p, l.profile, agency.vertical)) }))
    .filter((m) => m.fits.length)
    .sort((a, b) => b.fits.length - a.fits.length)
    .slice(0, 4);
  for (const { p, fits } of matches) {
    items.push({ kind: "match", priority: 5, title: `${p.ref} encaja con ${fits.length} cliente${fits.length > 1 ? "s" : ""}`, detail: `${p.title}${p.price ? ` · ${formatPrice(p.price)}` : ""} · ${fits.slice(0, 3).map(firstName).join(", ")}`, href: "/app/properties" });
  }
  for (const p of props.filter((p) => p.origin === "voz" && agency.vertical === "venta" && !p.price)) {
    items.push({ kind: "complete", priority: 7, title: `Completar la ficha de ${p.ref}`, detail: `${p.title}: falta el precio`, href: "/app/properties" });
  }

  items.sort((a, b) => a.priority - b.priority || (a.time ?? "").localeCompare(b.time ?? ""));
  return { items, script: speechScript(agency, items, now) };
}

function speechScript(agency: Agency, items: TodayItem[], now: Date): string {
  const hour = localParts(now, agency.timezone).h;
  const hello = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  if (!items.length) return `${hello}. Hoy no hay nada pendiente en ${agency.name}. El asistente sigue atendiendo a los clientes por ti.`;
  const count = (k: TodayKind) => items.filter((i) => i.kind === k);
  const parts = [`${hello}. Esto es lo que tienes hoy en ${agency.name}.`];
  const inc = count("incident");
  if (inc.length) parts.push(`Lo primero: ${inc.length === 1 ? "hay una incidencia abierta" : `hay ${inc.length} incidencias abiertas`}. ${inc.slice(0, 2).map((i) => i.title).join(". ")}.`);
  const vis = count("visit");
  if (vis.length) parts.push(`Tienes ${vis.length === 1 ? "una visita" : `${vis.length} visitas`}: ${vis.map((v) => `a las ${v.time}, ${v.title.replace("Visita con ", "con ")}`).join("; ")}.`);
  const hot = count("hot");
  if (hot.length) parts.push(`${hot.length === 1 ? "Hay un cliente listo" : `Hay ${hot.length} clientes listos`} ${agency.vertical === "vacacional" ? "para reservar" : "para comprar"}. Llama primero a ${hot.slice(0, 3).map((h) => h.title.replace(/^Llamar a /, "").replace(/ \(\d+\/100\)$/, "")).join(", ")}.`);
  const conf = count("confirm");
  if (conf.length) parts.push(`Confirma ${conf.length === 1 ? "una visita agendada" : `${conf.length} visitas agendadas`} por el asistente.`);
  const send = count("send");
  if (send.length) parts.push(`Tienes ${send.length === 1 ? "un mensaje preparado" : `${send.length} mensajes preparados`} para enviar por WhatsApp a contactos de portales o llamadas.`);
  const match = count("match");
  if (match.length) parts.push(`${match.length === 1 ? "Una propiedad nueva encaja" : `${match.length} propiedades nuevas encajan`} con clientes que tienes en seguimiento.`);
  const revive = count("revive");
  if (revive.length) parts.push(`Y ${revive.length === 1 ? "un cliente interesado lleva" : `${revive.length} clientes interesados llevan`} días sin responder: vale la pena una llamada.`);
  parts.push("Que tengas un buen día.");
  return parts.join(" ");
}
