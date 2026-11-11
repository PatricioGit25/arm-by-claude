/**
 * Entrada de clientes que NO escriben por el chat:
 *  - emails de aviso de portales (Idealista, Fotocasa, Rightmove, Kyero...)
 *  - notas o audios del agente tras una llamada o una visita a la oficina
 * La IA (o el modo demo) extrae los datos, crea o actualiza la ficha y redacta
 * el primer mensaje al cliente.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { events, leads, messages, properties, type Agency, type Lang, type Lead, type LeadProfile, type Property } from "./db/schema";
import { extractIntakeWithClaude, hasClaude, writeOutreach } from "./agent/claude";
import { extractProfile } from "./agent/mock";
import { extractDates, extractGuests } from "./agent/mock-vacation";
import { detectLang } from "./i18n";
import { findLeadByContact, logEvent, notify, phoneKey, runAgentTurn, sendOutbound } from "./engine";
import { formatPrice, nextStage, norm, propertyMatches, scoreLead } from "./scoring";

export interface Intake {
  name?: string;
  phone?: string;
  email?: string;
  language?: Lang;
  propertyRef?: string;
  clientMessage?: string;
  portal?: string;
  summary?: string;
  profile: Partial<LeadProfile>;
}

const PORTALS: [RegExp, string][] = [
  [/idealista/i, "Idealista"], [/fotocasa/i, "Fotocasa"], [/habitaclia/i, "Habitaclia"], [/pisos\.com/i, "Pisos.com"],
  [/milanuncios/i, "Milanuncios"], [/rightmove/i, "Rightmove"], [/kyero/i, "Kyero"], [/thinkspain/i, "ThinkSpain"],
  [/green-acres/i, "Green-Acres"], [/hemnet/i, "Hemnet"], [/resales/i, "Resales Online"], [/zoopla/i, "Zoopla"],
  [/immo(welt|scout)/i, "ImmoScout/Immowelt"], [/seloger/i, "SeLoger"], [/booking\.com/i, "Booking.com"], [/airbnb/i, "Airbnb"],
];
const SYSTEM_SENDER = /(no-?reply|noreply|notificacion|notification|mailer|alertas?|info@idealista|@idealista|@fotocasa|@rightmove|@kyero|@habitaclia|@hemnet)/i;

export function detectPortal(text: string): string | undefined {
  return PORTALS.find(([re]) => re.test(text))?.[1];
}

function firstPhone(text: string): string | undefined {
  for (const m of text.matchAll(/(?:\+|00)?\d[\d\s.()-]{7,}\d/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15 && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(m[0].trim())) return m[0].trim();
  }
}

function clientEmail(text: string): string | undefined {
  return [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]).find((e) => !SYSTEM_SENDER.test(e));
}

const NAME_STOP = new Set(["un", "una", "el", "la", "los", "las", "señor", "señora", "cliente", "chico", "chica", "pareja", "matrimonio", "hombre", "mujer", "alguien", "por", "que", "de", "con"]);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function nameFrom(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const m of text.matchAll(re)) {
    const words = m[1].trim().split(/\s+/).slice(0, 3).filter((w) => /^[\p{L}'-]+$/u.test(w));
    const out: string[] = [];
    for (const w of words) {
      if (NAME_STOP.has(w.toLowerCase())) break;
      out.push(cap(w));
      if (out.length === 2) break;
    }
    if (out.length) return out.join(" ");
    }
  }
}

function findRef(text: string, catalog: Property[]): string | undefined {
  const up = text.toUpperCase();
  const byRef = catalog.find((p) => up.includes(p.ref.toUpperCase()));
  if (byRef) return byRef.ref;
  const t = norm(text);
  return catalog.find((p) => p.title.length > 8 && t.includes(norm(p.title)))?.ref;
}

function profileFrom(text: string, catalog: Property[], vertical: Agency["vertical"]): Partial<LeadProfile> {
  if (vertical === "vacacional") {
    const out: Partial<LeadProfile> = { ...extractDates(text) };
    const g = extractGuests(text);
    if (g) out.guests = g;
    if (/\b(perro|gato|mascota|dog|cat|pet|hund|katt|chien)\b/i.test(text)) out.pets = true;
    if (/\b(reservar|book|boka|buchen|réserver|disponib|available)\b/i.test(text)) out.wants_booking = true;
    return out;
  }
  const towns = [...new Set(catalog.flatMap((p) => [p.town, p.zone]).filter(Boolean))];
  const { name: _n, phone: _p, email: _e, ...profile } = extractProfile(text, towns);
  return profile;
}

/** Modo demo: lee un email de aviso de un portal con reglas. */
export function parsePortalEmailHeuristic(email: { from?: string; subject?: string; text: string }, catalog: Property[], vertical: Agency["vertical"]): Intake {
  const all = `${email.from ?? ""}\n${email.subject ?? ""}\n${email.text}`;
  const body = email.text;
  const msg =
    body.match(/(?:Mensaje|Message|Meddelande|Nachricht|Commentaires?|Comentarios?|Consulta)\s*[:：]\s*([\s\S]+?)(?:\n\s*\n|\n[-_=]{3,}|$)/i)?.[1]?.trim() ??
    body.split(/\n+/).map((l) => l.trim()).filter((l) => l.split(/\s+/).length >= 6 && !detectPortal(l) && !/@|https?:\/\//.test(l)).sort((a, b) => b.length - a.length)[0];
  const name = nameFrom(body, [
    /(?:Nombre|Name|Namn|Nom|Contacto|Contact)\s*[:：]\s*([^\n<]+)/i,
  ]) ?? nameFrom(`${email.subject ?? ""}\n${body}`, [
    /([\p{Lu}][\p{L}]+(?:\s[\p{Lu}][\p{L}]+)?)\s+(?:está interesad|te ha enviado|ha contactado|ha preguntado|is interested|has sent|has contacted)/u,
  ]);
  const clientMessage = msg?.replace(/^["“'«]+|["”'»]+$/g, "").trim().slice(0, 1500);
  const ref = findRef(all, catalog);
  return {
    name,
    phone: firstPhone(body),
    email: clientEmail(body),
    language: clientMessage ? detectLang(clientMessage) : undefined,
    propertyRef: ref,
    clientMessage,
    portal: detectPortal(all) ?? "Portal",
    profile: { ...profileFrom(`${clientMessage ?? ""}`, catalog, vertical), ...(ref ? { property_ref: ref } : {}) },
  };
}

/** Modo demo: lee la nota (o el audio dictado) del agente con reglas. */
export function parseNoteHeuristic(note: string, catalog: Property[], vertical: Agency["vertical"]): Intake {
  let language: Lang | undefined;
  if (/\b(su[eé]c[oa]s?|swedish|svensk)/i.test(note)) language = "sv";
  else if (/\b(ingl[eé]s|inglesa|brit[aá]nic[oa]|english)/i.test(note)) language = "en";
  else if (/\b(alem[aá]n|alemana|german)/i.test(note)) language = "de";
  else if (/\b(franc[eé]s|francesa|french)/i.test(note)) language = "fr";
  const name = nameFrom(note, [
    /(?:se llama|nombre|cliente|me llam[oó]|llam[oó]|ha llamado|vino|pas[oó] por la oficina|habl[eé] con|visita de|called|name)\s*:?\s+([^\n,.;]+)/i,
  ]);
  const ref = findRef(note, catalog);
  const email = clientEmail(note);
  return {
    name,
    phone: firstPhone(note),
    email,
    language,
    propertyRef: ref,
    profile: { ...profileFrom(note, catalog, vertical), ...(ref ? { property_ref: ref } : {}) },
  };
}

async function extract(kind: "email" | "note", text: string, agency: Agency, catalog: Property[], email?: { from?: string; subject?: string }): Promise<Intake> {
  const heuristic = kind === "email"
    ? parsePortalEmailHeuristic({ ...email, text }, catalog, agency.vertical)
    : parseNoteHeuristic(text, catalog, agency.vertical);
  if (!hasClaude()) return heuristic;
  try {
    const ai = await extractIntakeWithClaude(kind, kind === "email" ? `De: ${email?.from ?? ""}\nAsunto: ${email?.subject ?? ""}\n\n${text}` : text, agency, catalog);
    return { ...ai, portal: ai.portal ?? heuristic.portal };
  } catch (err) {
    console.error("[ARM] Extracción con IA falló, uso reglas:", err);
    return heuristic;
  }
}

async function upsertLead(agency: Agency, intake: Intake, channel: "portal" | "manual", source: string): Promise<{ lead: Lead; created: boolean }> {
  const db = await getDb();
  const existing = await findLeadByContact(agency.id, intake.phone, intake.email);
  if (existing) {
    const [lead] = await db.update(leads).set({
      name: existing.name ?? intake.name ?? null,
      phone: existing.phone ?? intake.phone ?? null,
      email: existing.email ?? intake.email ?? null,
      profile: { ...existing.profile, ...intake.profile },
      updatedAt: new Date(),
    }).where(eq(leads.id, existing.id)).returning();
    return { lead, created: false };
  }
  const [lead] = await db.insert(leads).values({
    agencyId: agency.id, channel, source,
    externalId: intake.email?.toLowerCase() || phoneKey(intake.phone) || crypto.randomUUID(),
    name: intake.name, phone: intake.phone, email: intake.email, language: intake.language ?? "es",
    profile: intake.profile,
  }).returning();
  await logEvent(agency.id, lead.id, "lead_created", { source });
  return { lead, created: true };
}

/** Email de aviso de un portal (reenviado al buzón del ARM o pegado en el panel). */
export async function ingestPortalEmail(agency: Agency, email: { from?: string; subject?: string; text: string; messageId?: string }) {
  const db = await getDb();
  const text = email.text.slice(0, 20000);
  // Idempotencia: el mismo email reenviado dos veces no crea dos contactos.
  if (email.messageId) {
    const seen = await db.select({ id: events.id }).from(events).where(and(
      eq(events.agencyId, agency.id), eq(events.type, "inbound_email"), sql`${events.data}->>'messageId' = ${email.messageId}`,
    )).limit(1);
    if (seen.length) return { ok: false as const, duplicate: true, error: "Este email ya se había recibido." };
  }
  const catalog = await db.select().from(properties).where(eq(properties.agencyId, agency.id));
  const intake = await extract("email", text, agency, catalog, email);
  const log = (data: Record<string, unknown>) => logEvent(agency.id, (data.leadId as string) ?? null, "inbound_email", {
    from: email.from, subject: email.subject, messageId: email.messageId, ...data,
  });
  if (!intake.phone && !intake.email && !intake.clientMessage) {
    await log({ ok: false, preview: text.slice(0, 1500) });
    return { ok: false as const, error: "No encontré datos de un cliente en ese email (ni teléfono, ni email, ni mensaje)." };
  }
  const source = intake.portal ?? "Portal";
  let { lead } = await upsertLead(agency, intake, "portal", source);
  const prop = catalog.find((p) => p.ref === intake.propertyRef);
  const body = intake.clientMessage || `(Contacto desde ${source}${prop ? ` por ${prop.title}` : ""}, sin mensaje)`;
  await db.insert(messages).values({ agencyId: agency.id, leadId: lead.id, direction: "in", author: "lead", body: `[${source}${prop ? ` · ${prop.ref}` : ""}] ${body}` });
  [lead] = await db.update(leads).set({
    inboundCount: lead.inboundCount + 1, lastInboundAt: new Date(), updatedAt: new Date(),
    language: intake.language ?? lead.language,
    stage: ["seguimiento", "perdido"].includes(lead.stage) ? "calificando" : lead.stage,
  }).where(eq(leads.id, lead.id)).returning();
  await logEvent(agency.id, lead.id, "portal_lead", { portal: source, ref: prop?.ref });
  await log({ ok: true, leadId: lead.id, portal: source });
  await notify(agency, lead, "portal", `📥 Nuevo contacto de ${source}: ${lead.name ?? lead.phone ?? lead.email ?? "sin nombre"}`,
    `${prop ? `${prop.ref} · ${prop.title}\n` : ""}${body.slice(0, 300)}`);
  if (lead.aiPaused) return { ok: true as const, lead, reply: null };
  const r = await runAgentTurn(agency, lead);
  return { ok: true as const, lead: r.lead, reply: r.reply };
}

/** Nota o audio dictado por el agente tras una llamada o una visita a la oficina. */
export async function ingestNote(agency: Agency, note: string, opts: { source: string; language?: Lang }) {
  const db = await getDb();
  const catalog = await db.select().from(properties).where(eq(properties.agencyId, agency.id));
  const intake = await extract("note", note.slice(0, 5000), agency, catalog);
  if (opts.language) intake.language = opts.language;
  let { lead } = await upsertLead(agency, intake, "manual", opts.source);

  await db.insert(messages).values({ agencyId: agency.id, leadId: lead.id, direction: "out", author: "system", body: `📝 ${opts.source}: ${note}` });
  const profile = { ...lead.profile, ...intake.profile };
  const { score } = scoreLead(profile, { inboundCount: 1, hasContact: !!(lead.phone || lead.email) }, agency.vertical);
  const stage = nextStage(lead.stage, Math.max(score, 1), agency.handoffThreshold);
  [lead] = await db.update(leads).set({
    profile, score, stage, language: intake.language ?? lead.language,
    summary: intake.summary ?? `${opts.source}: ${note.slice(0, 280)}`,
    nextFollowupAt: ["nuevo", "calificando", "seguimiento"].includes(stage) ? new Date(Date.now() + 3 * 86400000) : null,
    updatedAt: new Date(),
  }).where(eq(leads.id, lead.id)).returning();
  await logEvent(agency.id, lead.id, "note_added", { source: opts.source });

  const matches = catalog.filter((p) => propertyMatches(p, profile, agency.vertical)).slice(0, 2);
  const outreach = await outreachText(agency, lead, note, opts.source, matches);
  await sendOutbound(agency, lead, outreach, "ai");
  return { lead, outreach };
}

async function outreachText(agency: Agency, lead: Lead, note: string, source: string, matches: Property[]): Promise<string> {
  if (hasClaude()) {
    try {
      return await writeOutreach({ agency, lead, note, source, matches });
    } catch (err) {
      console.error("[ARM] Mensaje inicial con IA falló, uso plantilla:", err);
    }
  }
  const vacation = agency.vertical === "vacacional";
  const first = lead.name ? ` ${lead.name.split(" ")[0]}` : "";
  const how = /oficina|visita|office/i.test(source) ? "visit" : "call";
  const list = matches.map((p) => `• ${p.title}${vacation ? ` (${p.maxGuests} pers.)${p.bookingUrl ? ` ${p.bookingUrl}` : ""}` : ` — ${formatPrice(p.price)}`}`).join("\n");
  const T: Record<Lang, [string, string, string, string]> = {
    es: [`¡Hola${first}! Soy ${agency.assistantName}, de ${agency.name}.`, how === "visit" ? "Gracias por pasar por la oficina." : "Gracias por llamarnos.", "Te escribo por aquí para que tengas todo a mano. Esto encaja con lo que buscas:", "¿Te parece bien que te vaya enviando opciones por aquí?"],
    en: [`Hi${first}! I'm ${agency.assistantName} from ${agency.name}.`, how === "visit" ? "Thanks for stopping by the office." : "Thanks for calling us.", "I'm writing here so you have everything handy. This matches what you're looking for:", "Is it OK if I send you options here?"],
    sv: [`Hej${first}! Jag heter ${agency.assistantName} och jobbar på ${agency.name}.`, how === "visit" ? "Tack för att du kom förbi kontoret." : "Tack för att du ringde oss.", "Jag skriver här så att du har allt nära till hands. Det här passar det du söker:", "Går det bra att jag skickar förslag här?"],
    de: [`Hallo${first}! Ich bin ${agency.assistantName} von ${agency.name}.`, how === "visit" ? "Danke für Ihren Besuch im Büro." : "Danke für Ihren Anruf.", "Ich schreibe Ihnen hier, damit Sie alles griffbereit haben. Das passt zu Ihrer Suche:", "Darf ich Ihnen hier weitere Angebote schicken?"],
    fr: [`Bonjour${first} ! Je suis ${agency.assistantName}, de ${agency.name}.`, how === "visit" ? "Merci d'être passé à l'agence." : "Merci de nous avoir appelés.", "Je vous écris ici pour que vous ayez tout sous la main. Voici ce qui correspond à votre recherche :", "Puis-je vous envoyer d'autres options ici ?"],
  };
  const [hi, thanks, intro, outro] = T[lead.language] ?? T.es;
  return matches.length ? `${hi} ${thanks}\n${intro}\n${list}\n${outro}` : `${hi} ${thanks} ${outro}`;
}

/** Último mensaje de la IA aún no enviado al cliente por un canal automático. */
export async function lastDraft(leadId: string): Promise<string | undefined> {
  const db = await getDb();
  const out = await db.select().from(messages).where(and(eq(messages.leadId, leadId), eq(messages.author, "ai")));
  return out.sort((a, b) => +b.createdAt - +a.createdAt)[0]?.body;
}
