/**
 * Motor de ARM: recibe mensajes, hace hablar al agente de IA, actualiza el CRM
 * solo, programa seguimientos y avisa al agente humano cuando hay un comprador real.
 */
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  agencies, events, leads, messages, notifications, properties, visits,
  type Agency, type Lead, type LeadProfile, type Property, type Stage,
} from "./db/schema";
import { runClaudeAgent, hasClaude, writeFollowup } from "./agent/claude";
import { runMockAgent } from "./agent/mock";
import { describeProperty } from "./agent/tools";
import type { AgentOutput } from "./agent/types";
import { sendWhatsAppText, whatsappEnabled } from "./channels/whatsapp";
import { formatPrice, nextStage, propertyMatches, scoreLead } from "./scoring";

const DAY = 86_400_000;
/** Días entre seguimientos: día 3, 10, 30 y 60 desde el último contacto. */
const FOLLOWUP_GAPS = [3, 7, 20, 30];
const AI_STAGES: Stage[] = ["nuevo", "calificando", "seguimiento"];

export interface InboundInput {
  agency: Agency;
  channel: "web" | "whatsapp" | "portal" | "email";
  externalId: string;
  text: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
}

export async function getAgencyBySlug(slug: string) {
  const db = await getDb();
  return (await db.select().from(agencies).where(eq(agencies.slug, slug)))[0];
}

export async function handleInbound(input: InboundInput): Promise<{ lead: Lead; reply: string | null; engine?: string }> {
  const db = await getDb();
  const { agency } = input;
  const now = new Date();

  let lead = (
    await db.select().from(leads).where(and(
      eq(leads.agencyId, agency.id), eq(leads.channel, input.channel), eq(leads.externalId, input.externalId),
    ))
  )[0];
  if (!lead) {
    [lead] = await db.insert(leads).values({
      agencyId: agency.id, channel: input.channel, externalId: input.externalId,
      name: input.name, phone: input.phone, email: input.email,
      source: input.source ?? (input.channel === "whatsapp" ? "WhatsApp" : "Web"),
    }).returning();
    await logEvent(agency.id, lead.id, "lead_created", { source: lead.source });
  }

  await db.insert(messages).values({ agencyId: agency.id, leadId: lead.id, direction: "in", author: "lead", body: input.text });
  [lead] = await db.update(leads).set({
    inboundCount: lead.inboundCount + 1,
    lastInboundAt: now,
    updatedAt: now,
    followupCount: 0,
    nextFollowupAt: null,
    stage: lead.stage === "seguimiento" || lead.stage === "perdido" ? "calificando" : lead.stage,
    lostReason: null,
  }).where(eq(leads.id, lead.id)).returning();

  if (lead.aiPaused) {
    await notify(agency, lead, "message", `Nuevo mensaje de ${lead.name ?? "un cliente"}`, input.text);
    return { lead, reply: null };
  }

  const history = await db.select().from(messages).where(eq(messages.leadId, lead.id)).orderBy(asc(messages.createdAt)).limit(60);
  const catalog = await db.select().from(properties).where(eq(properties.agencyId, agency.id));

  let result: AgentOutput;
  try {
    result = hasClaude() ? await runClaudeAgent({ agency, lead, history, catalog }) : await runMockAgent({ agency, lead, history, catalog });
  } catch (err) {
    console.error("[ARM] Fallo del agente de IA, uso el agente demo:", err);
    result = await runMockAgent({ agency, lead, history, catalog });
  }

  lead = await applyTurn(agency, lead, result, catalog);
  const reply = result.reply || "";
  if (reply) await sendOutbound(agency, lead, reply, "ai");
  return { lead, reply, engine: result.engine };
}

async function applyTurn(agency: Agency, lead: Lead, out: AgentOutput, catalog: Property[]): Promise<Lead> {
  const db = await getDb();
  const { state } = out;
  const profile: LeadProfile = { ...lead.profile, ...state.profilePatch };
  const contact = { ...state.contactPatch };
  const hasContact = !!(lead.phone || lead.email || contact.phone || contact.email);
  const { score } = scoreLead(profile, { inboundCount: lead.inboundCount, hasContact });

  let stage = nextStage(lead.stage, score, agency.handoffThreshold);
  const patch: Partial<Lead> = {
    profile, score, updatedAt: new Date(),
    ...(contact.name && { name: contact.name }),
    ...(contact.email && { email: contact.email }),
    ...(contact.phone && { phone: contact.phone }),
    ...(contact.language && { language: contact.language }),
  };

  if (Object.keys(state.profilePatch).length) await logEvent(agency.id, lead.id, "profile_updated", state.profilePatch);

  if (state.visit) {
    const prop = catalog.find((p) => p.ref === state.visit!.propertyRef);
    await db.insert(visits).values({ agencyId: agency.id, leadId: lead.id, propertyId: prop?.id, preferredTime: state.visit.preferredTime });
    await logEvent(agency.id, lead.id, "visit_requested", { ref: prop?.ref, when: state.visit.preferredTime });
    stage = "visita";
  }

  const firstHandoff = !lead.handedOffAt && (state.handoff || stage === "listo" || stage === "visita");
  if (state.handoff || firstHandoff) {
    const summary = state.handoff?.summary ?? lead.summary ?? `Puntaje ${score}. Perfil: ${JSON.stringify(profile)}`;
    patch.summary = summary;
    if (!lead.handedOffAt) {
      patch.handedOffAt = new Date();
      if (stage !== "visita") stage = "listo";
      await logEvent(agency.id, lead.id, "handoff", { reason: state.handoff?.reason, summary, score });
      const who = contact.name ?? lead.name ?? "Nuevo comprador";
      const visitTxt = state.visit ? `\n📅 Visita pedida: ${state.visit.preferredTime}${state.visit.propertyRef ? ` (${state.visit.propertyRef})` : ""}` : "";
      await notify(agency, lead, "handoff", `🔥 Lead listo: ${who} (${score}/100)`, `${summary}${visitTxt}\n📞 ${contact.phone ?? lead.phone ?? "sin teléfono"} · ${lead.channel}`);
    }
  }

  patch.stage = stage;
  if (AI_STAGES.includes(stage)) patch.nextFollowupAt = new Date(Date.now() + FOLLOWUP_GAPS[0] * DAY);
  if (stage !== lead.stage) await logEvent(agency.id, lead.id, "stage_changed", { from: lead.stage, to: stage });

  const [updated] = await db.update(leads).set(patch).where(eq(leads.id, lead.id)).returning();
  return updated;
}

export async function sendOutbound(agency: Agency, lead: Lead, body: string, author: "ai" | "agent" | "system") {
  const db = await getDb();
  await db.insert(messages).values({ agencyId: agency.id, leadId: lead.id, direction: "out", author, body });
  await db.update(leads).set({ lastOutboundAt: new Date() }).where(eq(leads.id, lead.id));
  if (lead.channel === "whatsapp" && lead.externalId && whatsappEnabled(agency.waPhoneNumberId)) {
    try {
      await sendWhatsAppText(agency.waPhoneNumberId!, lead.externalId, body);
    } catch (err) {
      console.error("[ARM] Error enviando WhatsApp:", err);
      await logEvent(agency.id, lead.id, "send_failed", { error: String(err) });
    }
  }
}

export async function notify(agency: Agency, lead: Lead | null, kind: string, title: string, body: string) {
  const db = await getDb();
  await db.insert(notifications).values({ agencyId: agency.id, leadId: lead?.id, kind, title, body });
  if (agency.agentPhone && whatsappEnabled(agency.waPhoneNumberId) && kind !== "message") {
    try {
      await sendWhatsAppText(agency.waPhoneNumberId!, agency.agentPhone, `${title}\n\n${body}`);
    } catch (err) {
      console.error("[ARM] No se pudo avisar al agente por WhatsApp:", err);
    }
  }
}

export async function logEvent(agencyId: string, leadId: string | null, type: string, data: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(events).values({ agencyId, leadId, type, data });
}

/** Seguimientos automáticos (llamar desde un cron, p. ej. cada hora). */
export async function runFollowups(now = new Date()): Promise<{ sent: number; lost: number }> {
  const db = await getDb();
  const due = await db.select().from(leads).where(and(
    isNotNull(leads.nextFollowupAt), lte(leads.nextFollowupAt, now),
    eq(leads.aiPaused, false), inArray(leads.stage, AI_STAGES),
  )).limit(200);

  let sent = 0, lost = 0;
  for (const lead of due) {
    const agency = (await db.select().from(agencies).where(eq(agencies.id, lead.agencyId)))[0];
    const attempt = lead.followupCount + 1;
    if (attempt > FOLLOWUP_GAPS.length) {
      await db.update(leads).set({ stage: "perdido", lostReason: "Sin respuesta tras 4 seguimientos", nextFollowupAt: null, updatedAt: now }).where(eq(leads.id, lead.id));
      await logEvent(agency.id, lead.id, "stage_changed", { from: lead.stage, to: "perdido", reason: "sin respuesta" });
      lost++;
      continue;
    }
    const catalog = await db.select().from(properties).where(and(eq(properties.agencyId, agency.id), eq(properties.status, "disponible")));
    const since = lead.lastOutboundAt ?? lead.createdAt;
    const fresh = catalog.filter((p) => p.createdAt > since && propertyMatches(p, lead.profile)).map(describeProperty);
    const body = await followupText(agency, lead, attempt, fresh);
    await sendOutbound(agency, lead, body, "ai");
    await db.update(leads).set({
      stage: "seguimiento", followupCount: attempt, updatedAt: now,
      nextFollowupAt: new Date(now.getTime() + FOLLOWUP_GAPS[attempt] * DAY || now.getTime() + 30 * DAY),
    }).where(eq(leads.id, lead.id));
    await logEvent(agency.id, lead.id, "followup_sent", { attempt });
    sent++;
  }
  return { sent, lost };
}

async function followupText(agency: Agency, lead: Lead, attempt: number, fresh: string[]): Promise<string> {
  if (hasClaude()) {
    try {
      return await writeFollowup({ agency, lead, attempt, newMatches: fresh });
    } catch (err) {
      console.error("[ARM] Seguimiento con IA falló, uso plantilla:", err);
    }
  }
  const name = lead.name ? ` ${lead.name.split(" ")[0]}` : "";
  const T = {
    es: [`¡Hola${name}! ¿Sigues buscando propiedad por la zona? Si quieres te paso las últimas novedades. 😊`, `Hola${name}, han entrado propiedades nuevas que podrían encajarte. ¿Te las envío?`, `Hola${name}, ¿cómo va la búsqueda? Si cambió algo (presupuesto, zona, fechas) dímelo y te ayudo.`, `Hola${name}, te escribo por última vez para no molestar. Si en algún momento vuelves a buscar, aquí estaré. 🏡`],
    en: [`Hi${name}! Are you still looking for a property in the area? Happy to send you the latest listings. 😊`, `Hi${name}, some new properties just came in that could suit you. Shall I send them over?`, `Hi${name}, how's the search going? If anything changed (budget, area, dates) just let me know.`, `Hi${name}, this is my last message so I don't bother you. Whenever you're looking again, I'm here. 🏡`],
    sv: [`Hej${name}! Letar du fortfarande efter en bostad här? Jag skickar gärna de senaste objekten. 😊`, `Hej${name}, det har kommit in nya objekt som kan passa dig. Ska jag skicka dem?`, `Hej${name}, hur går sökandet? Om något har ändrats (budget, område, datum) säg bara till.`, `Hej${name}, det här är mitt sista meddelande så jag inte stör. När du letar igen finns jag här. 🏡`],
  }[lead.language] ?? [];
  const base = T[Math.min(attempt - 1, T.length - 1)];
  return fresh.length ? `${base}\n${fresh.map((f) => "• " + f.split(" | ").slice(0, 2).join(": ") + " — " + f.split(" | ")[3]).join("\n")}` : base;
}

/** Cuando entra una propiedad nueva: avisa a los leads que encajan. */
export async function matchNewProperty(agency: Agency, property: Property): Promise<number> {
  const db = await getDb();
  const candidates = await db.select().from(leads).where(and(
    eq(leads.agencyId, agency.id), eq(leads.aiPaused, false), inArray(leads.stage, ["calificando", "seguimiento"]),
  ));
  let n = 0;
  for (const lead of candidates.filter((l) => propertyMatches(property, l.profile))) {
    const msg = {
      es: `¡Hola${lead.name ? " " + lead.name.split(" ")[0] : ""}! Acaba de entrar algo que encaja con lo que buscas: ${property.ref}, ${property.title} — ${formatPrice(property.price)}. ¿Quieres más info o verla?`,
      en: `Hi${lead.name ? " " + lead.name.split(" ")[0] : ""}! Something new just came in that matches what you're after: ${property.ref}, ${property.title} — ${formatPrice(property.price)}. Want more details or a viewing?`,
      sv: `Hej${lead.name ? " " + lead.name.split(" ")[0] : ""}! Något nytt har precis kommit in som passar det du söker: ${property.ref}, ${property.title} — ${formatPrice(property.price)}. Vill du ha mer info eller boka en visning?`,
    }[lead.language];
    await sendOutbound(agency, lead, msg, "ai");
    await logEvent(agency.id, lead.id, "property_match", { ref: property.ref });
    n++;
  }
  return n;
}

/** Datos del "resumen de la mañana". */
export async function morningSummary(agencyId: string, now = new Date()) {
  const db = await getDb();
  const since = new Date(now.getTime() - DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const all = await db.select().from(leads).where(eq(leads.agencyId, agencyId));
  const recent = all.filter((l) => l.createdAt >= monthAgo);

  const entered24 = all.filter((l) => l.createdAt >= since).length;
  const ready = all.filter((l) => ["listo", "visita", "oferta"].includes(l.stage)).length;
  const readyNew = all.filter((l) => l.handedOffAt && l.handedOffAt >= since).length;
  const following = all.filter((l) => l.stage === "seguimiento" || l.stage === "calificando").length;

  const reached = (l: Lead, step: number) => {
    const p = l.profile;
    switch (step) {
      case 0: return true;
      case 1: return l.inboundCount >= 2 || !!l.handedOffAt;
      case 2: return (!!p.budget_max && !!p.property_type) || !!l.handedOffAt;
      case 3: return !!l.handedOffAt || ["listo", "visita", "oferta", "cerrado"].includes(l.stage);
      case 4: return ["visita", "oferta", "cerrado"].includes(l.stage);
      default: return l.stage === "cerrado";
    }
  };
  const labels = ["Entraron", "Respondieron", "Calificados", "Listos para comprar", "Visita", "Cerrado"];
  const funnel = labels.map((label, i) => ({ label, count: recent.filter((l) => reached(l, i)).length }));
  let worst = { from: "", to: "", lost: 0, pct: 0 };
  for (let i = 1; i < funnel.length - 1; i++) {
    const lost = funnel[i - 1].count - funnel[i].count;
    const pct = funnel[i - 1].count ? lost / funnel[i - 1].count : 0;
    if (pct > worst.pct) worst = { from: funnel[i - 1].label, to: funnel[i].label, lost, pct };
  }

  const [{ msgs }] = await db.select({ msgs: sql<number>`count(*)::int` }).from(messages)
    .where(and(eq(messages.agencyId, agencyId), eq(messages.author, "ai"), sql`${messages.createdAt} >= ${since.toISOString()}`));
  const afterHours = all.filter((l) => l.lastInboundAt && l.lastInboundAt >= since && (l.lastInboundAt.getHours() >= 20 || l.lastInboundAt.getHours() < 9)).length;

  return { entered24, ready, readyNew, following, total: all.length, funnel, worst, aiMessages24: msgs, afterHours };
}

export async function latestNotifications(agencyId: string, limit = 8) {
  const db = await getDb();
  return db.select().from(notifications).where(eq(notifications.agencyId, agencyId)).orderBy(desc(notifications.createdAt)).limit(limit);
}
