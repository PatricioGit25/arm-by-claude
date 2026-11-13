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
  channel: "web" | "whatsapp" | "portal" | "email" | "manual";
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

export function phoneKey(phone?: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
}

/** Busca un cliente existente de la agencia por teléfono o email (para no duplicar). */
export async function findLeadByContact(agencyId: string, phone?: string | null, email?: string | null): Promise<Lead | undefined> {
  const pk = phoneKey(phone);
  const em = email?.trim().toLowerCase();
  if (!pk && !em) return undefined;
  const db = await getDb();
  const all = await db.select().from(leads).where(eq(leads.agencyId, agencyId)).orderBy(desc(leads.updatedAt));
  return all.find((l) => (pk && phoneKey(l.phone) === pk) || (em && l.email?.toLowerCase() === em));
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
    const existing = await findLeadByContact(agency.id, input.phone, input.email);
    if (existing) {
      // Mismo cliente que ya entró por otro canal (portal, llamada...): ahora escribe por aquí.
      [lead] = await db.update(leads).set({ channel: input.channel, externalId: input.externalId, name: existing.name ?? input.name })
        .where(eq(leads.id, existing.id)).returning();
      await logEvent(agency.id, lead.id, "channel_linked", { channel: input.channel });
    }
  }
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
  return runAgentTurn(agency, lead);
}

/** Hace hablar al agente de IA sobre la conversación actual del cliente y aplica lo que decida. */
export async function runAgentTurn(agency: Agency, lead: Lead): Promise<{ lead: Lead; reply: string | null; engine?: string }> {
  const db = await getDb();
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
  const vacation = agency.vertical === "vacacional";
  const profile: LeadProfile = { ...lead.profile, ...state.profilePatch };
  const contact = { ...state.contactPatch };
  const hasContact = !!(lead.phone || lead.email || contact.phone || contact.email);
  const { score } = scoreLead(profile, { inboundCount: lead.inboundCount, hasContact }, agency.vertical);
  const who = contact.name ?? lead.name ?? (vacation ? "Cliente" : "Nuevo comprador");
  const phone = `📞 ${contact.phone ?? lead.phone ?? "sin teléfono"} · ${lead.channel}`;

  // Un huésped confirmado no vuelve a "consultando" por puntaje.
  const isGuest = !!lead.guestPropertyId || ["reservado", "huesped", "incidencia"].includes(lead.stage);
  let stage = isGuest ? lead.stage : nextStage(lead.stage, score, agency.handoffThreshold);
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
    const startsAt = state.visit.startsAt ? new Date(state.visit.startsAt) : null;
    await db.insert(visits).values({
      agencyId: agency.id, leadId: lead.id, propertyId: prop?.id, preferredTime: state.visit.preferredTime,
      scheduledAt: startsAt, endsAt: startsAt ? new Date(startsAt.getTime() + agency.visitMinutes * 60000) : null,
      status: startsAt ? "agendada" : "pendiente",
    });
    await logEvent(agency.id, lead.id, "visit_requested", { ref: prop?.ref, when: state.visit.preferredTime });
    stage = "visita";
  }

  if (state.incident) {
    const prop = catalog.find((p) => p.ref === state.incident!.propertyRef) ?? catalog.find((p) => p.id === lead.guestPropertyId);
    const where = prop ? prop.title : "alojamiento sin identificar";
    stage = "incidencia";
    patch.summary = `Incidencia en ${where}: ${state.incident.description}`;
    await logEvent(agency.id, lead.id, "incident", { ref: prop?.ref, urgent: state.incident.urgent, description: state.incident.description });
    await notify(agency, lead, "incident",
      `${state.incident.urgent ? "🚨 URGENTE" : "⚠️ Incidencia"}: ${where}`,
      `${who}: ${state.incident.description}\n${phone}`);
  }

  const autoReady = !lead.handedOffAt && !isGuest && (stage === "listo" || stage === "visita");
  if (state.handoff || autoReady) {
    const summary = state.handoff?.summary ?? lead.summary ?? `Puntaje ${score}. Perfil: ${JSON.stringify(profile)}`;
    if (!state.incident) patch.summary = summary;
    if (!isGuest && stage !== "visita" && (!vacation || profile.wants_booking || profile.check_in || score >= agency.handoffThreshold)) stage = "listo";
    if (!lead.handedOffAt) patch.handedOffAt = new Date();
    await logEvent(agency.id, lead.id, "handoff", { reason: state.handoff?.reason, summary, score });
    const visitTxt = state.visit ? `\n📅 ${state.visit.startsAt ? "Visita agendada" : "Visita pedida"}: ${state.visit.preferredTime}${state.visit.propertyRef ? ` (${state.visit.propertyRef})` : ""}` : "";
    const title = vacation
      ? stage === "listo" ? `🔥 Quiere reservar: ${who}` : `💬 ${who} necesita al equipo`
      : `🔥 Lead listo: ${who} (${score}/100)`;
    // En venta solo se avisa la primera vez; en vacacional, cada vez que la IA lo pide.
    if (state.handoff || !lead.handedOffAt) {
      if (vacation || !lead.handedOffAt) await notify(agency, lead, "handoff", title, `${summary}${visitTxt}\n${phone}`);
    }
  }

  patch.stage = stage;
  if (AI_STAGES.includes(stage)) patch.nextFollowupAt = new Date(Date.now() + FOLLOWUP_GAPS[0] * DAY);
  else patch.nextFollowupAt = null;
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
    const fresh = catalog.filter((p) => p.createdAt > since && propertyMatches(p, lead.profile, agency.vertical)).map(describeProperty);
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
  const SALE: Record<string, string[]> = {
    es: [`¡Hola${name}! ¿Sigues buscando propiedad por la zona? Si quieres te paso las últimas novedades. 😊`, `Hola${name}, han entrado propiedades nuevas que podrían encajarte. ¿Te las envío?`, `Hola${name}, ¿cómo va la búsqueda? Si cambió algo (presupuesto, zona, fechas) dímelo y te ayudo.`, `Hola${name}, te escribo por última vez para no molestar. Si en algún momento vuelves a buscar, aquí estaré. 🏡`],
    en: [`Hi${name}! Are you still looking for a property in the area? Happy to send you the latest listings. 😊`, `Hi${name}, some new properties just came in that could suit you. Shall I send them over?`, `Hi${name}, how's the search going? If anything changed (budget, area, dates) just let me know.`, `Hi${name}, this is my last message so I don't bother you. Whenever you're looking again, I'm here. 🏡`],
    sv: [`Hej${name}! Letar du fortfarande efter en bostad här? Jag skickar gärna de senaste objekten. 😊`, `Hej${name}, det har kommit in nya objekt som kan passa dig. Ska jag skicka dem?`, `Hej${name}, hur går sökandet? Om något har ändrats (budget, område, datum) säg bara till.`, `Hej${name}, det här är mitt sista meddelande så jag inte stör. När du letar igen finns jag här. 🏡`],
  };
  const VACATION: Record<string, string[]> = {
    es: [`¡Hola${name}! ¿Pudiste mirar los alojamientos que te pasé? Si quieres, el equipo te confirma disponibilidad para tus fechas. 😊`, `Hola${name}, ¿sigues buscando alojamiento en ${agency.town || "la zona"}? Las fechas buenas vuelan; dime y lo miramos.`, `Hola${name}, ¿cómo van los planes del viaje? Si cambiaron las fechas o sois más, dímelo y te propongo opciones.`, `Hola${name}, te escribo por última vez para no molestar. Cuando quieras volver a ${agency.town || "la costa"}, aquí estaremos. ☀️`],
    en: [`Hi${name}! Did you get a chance to look at the places I sent? The team can confirm availability for your dates if you like. 😊`, `Hi${name}, still looking for a place in ${agency.town || "the area"}? Good dates go fast, just let me know.`, `Hi${name}, how are the travel plans going? If dates or numbers changed, tell me and I'll suggest options.`, `Hi${name}, last message so I don't bother you. Whenever you want to come back to ${agency.town || "the coast"}, we're here. ☀️`],
    sv: [`Hej${name}! Hann du titta på boendena jag skickade? Teamet kan bekräfta tillgänglighet för era datum om du vill. 😊`, `Hej${name}, letar ni fortfarande boende i ${agency.town || "området"}? Bra datum går fort, säg bara till.`, `Hej${name}, hur går reseplanerna? Om datum eller antal har ändrats, säg till så föreslår jag alternativ.`, `Hej${name}, sista meddelandet så jag inte stör. När ni vill komma tillbaka till ${agency.town || "kusten"} finns vi här. ☀️`],
    de: [`Hallo${name}! Konnten Sie sich die Unterkünfte ansehen? Das Team bestätigt Ihnen gern die Verfügbarkeit für Ihre Daten. 😊`, `Hallo${name}, suchen Sie noch eine Unterkunft in ${agency.town || "der Gegend"}? Gute Termine sind schnell weg.`, `Hallo${name}, wie laufen die Reisepläne? Wenn sich Daten oder Personenzahl geändert haben, sagen Sie es mir.`, `Hallo${name}, meine letzte Nachricht, um nicht zu stören. Wenn Sie wieder nach ${agency.town || "an die Küste"} möchten, sind wir da. ☀️`],
    fr: [`Bonjour${name} ! Avez-vous pu regarder les logements envoyés ? L'équipe peut vous confirmer la disponibilité pour vos dates. 😊`, `Bonjour${name}, cherchez-vous toujours un logement à ${agency.town || "la côte"} ? Les bonnes dates partent vite.`, `Bonjour${name}, où en sont vos projets de voyage ? Si les dates ont changé, dites-le-moi.`, `Bonjour${name}, dernier message pour ne pas vous déranger. Quand vous voudrez revenir à ${agency.town || "la côte"}, nous serons là. ☀️`],
  };
  const COMMERCIAL: Record<string, string[]> = {
    es: [`¡Hola${name}! ¿Pudiste pensar en lo del asistente para tu agencia? Si quieres, te lo enseño funcionando con vuestras propiedades en 30 minutos.`, `Hola${name}, esta semana tengo huecos para la demo. ¿Te va bien que te proponga uno?`, `Hola${name}, te escribo por última vez para no molestar. Cuando quieras verlo, aquí estoy. 🙌`],
    en: [`Hi${name}! Did you get a chance to think about the assistant for your agency? I can show it working with your own listings in 30 minutes.`, `Hi${name}, I have demo slots this week. Shall I suggest one?`, `Hi${name}, last message so I don't bother you. Whenever you want to see it, I'm here. 🙌`],
  };
  const table = agency.vertical === "vacacional" ? VACATION : agency.vertical === "comercial" ? COMMERCIAL : SALE;
  const T = table[lead.language] ?? table.en;
  const base = T[Math.min(attempt - 1, T.length - 1)];
  return fresh.length ? `${base}\n${fresh.map((f) => "• " + f.split(" | ").slice(0, 2).join(": ")).join("\n")}` : base;
}

/** Cuando entra una propiedad nueva: avisa a los leads que encajan. */
export async function matchNewProperty(agency: Agency, property: Property): Promise<number> {
  const db = await getDb();
  const candidates = await db.select().from(leads).where(and(
    eq(leads.agencyId, agency.id), eq(leads.aiPaused, false), inArray(leads.stage, ["calificando", "seguimiento"]),
  ));
  let n = 0;
  for (const lead of candidates.filter((l) => propertyMatches(property, l.profile, agency.vertical))) {
    const first = lead.name ? " " + lead.name.split(" ")[0] : "";
    const what = agency.vertical === "vacacional"
      ? `${property.title} (${property.maxGuests} pers.)${property.bookingUrl ? ` ${property.bookingUrl}` : ""}`
      : `${property.ref}, ${property.title} — ${formatPrice(property.price)}`;
    const MSG: Record<string, string> = {
      es: `¡Hola${first}! Acabamos de sumar algo que encaja con lo que buscas: ${what}. ¿Quieres más info?`,
      en: `Hi${first}! We've just added something that matches what you're after: ${what}. Want more details?`,
      sv: `Hej${first}! Vi har precis lagt till något som passar det du söker: ${what}. Vill du ha mer info?`,
      de: `Hallo${first}! Wir haben gerade etwas Passendes aufgenommen: ${what}. Möchten Sie mehr Infos?`,
      fr: `Bonjour${first} ! Nous venons d'ajouter quelque chose qui correspond à votre recherche : ${what}. Plus d'infos ?`,
    };
    const msg = MSG[lead.language] ?? MSG.en;
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

  const agency = (await db.select().from(agencies).where(eq(agencies.id, agencyId)))[0];
  const vacation = agency?.vertical === "vacacional";

  const entered24 = all.filter((l) => l.createdAt >= since).length;
  const ready = all.filter((l) => (vacation ? ["listo"] : ["listo", "visita", "oferta"]).includes(l.stage)).length;
  const readyNew = all.filter((l) => l.handedOffAt && l.handedOffAt >= since).length;
  const following = all.filter((l) => l.stage === "seguimiento" || l.stage === "calificando").length;
  const incidents = all.filter((l) => l.stage === "incidencia").length;
  const guests = all.filter((l) => l.stage === "huesped" || l.stage === "reservado").length;

  const reached = (l: Lead, step: number) => {
    const p = l.profile;
    const done = vacation ? ["reservado", "huesped"].includes(l.stage) || (l.stage === "incidencia" && !!l.guestPropertyId) : false;
    switch (step) {
      case 0: return true;
      case 1: return l.inboundCount >= 2 || !!l.handedOffAt || done;
      case 2: return (vacation ? !!p.check_in && !!p.guests : agency?.vertical === "comercial" ? !!p.company : !!p.budget_max && !!p.property_type) || !!l.handedOffAt || done;
      case 3: return vacation ? !!p.wants_booking || l.stage === "listo" || done : !!l.handedOffAt || ["listo", "visita", "oferta", "cerrado"].includes(l.stage);
      case 4: return vacation ? done : ["visita", "oferta", "cerrado"].includes(l.stage);
      default: return l.stage === "cerrado";
    }
  };
  const labels = vacation
    ? ["Entraron", "Respondieron", "Con fechas y personas", "Quieren reservar", "Reservaron"]
    : ["Entraron", "Respondieron", "Calificados", "Listos para comprar", "Visita", "Cerrado"];
  const funnel = labels.map((label, i) => ({ label, count: recent.filter((l) => reached(l, i)).length }));
  let worst = { from: "", to: "", lost: 0, pct: 0 };
  for (let i = 1; i < funnel.length - (vacation ? 0 : 1); i++) {
    const lost = funnel[i - 1].count - funnel[i].count;
    const pct = funnel[i - 1].count ? lost / funnel[i - 1].count : 0;
    if (pct > worst.pct) worst = { from: funnel[i - 1].label, to: funnel[i].label, lost, pct };
  }

  const [{ msgs }] = await db.select({ msgs: sql<number>`count(*)::int` }).from(messages)
    .where(and(eq(messages.agencyId, agencyId), eq(messages.author, "ai"), sql`${messages.createdAt} >= ${since.toISOString()}`));
  const afterHours = all.filter((l) => l.lastInboundAt && l.lastInboundAt >= since && (l.lastInboundAt.getHours() >= 20 || l.lastInboundAt.getHours() < 9)).length;

  return { vacation, entered24, ready, readyNew, following, incidents, guests, total: all.length, funnel, worst, aiMessages24: msgs, afterHours };
}

export async function latestNotifications(agencyId: string, limit = 8) {
  const db = await getDb();
  return db.select().from(notifications).where(eq(notifications.agencyId, agencyId)).orderBy(desc(notifications.createdAt)).limit(limit);
}
