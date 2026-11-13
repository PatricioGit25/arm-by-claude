"use server";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { agencies, leads, properties, users, visits, STAGES, type Stage, type Vertical } from "@/lib/db/schema";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { logEvent, matchNewProperty, sendOutbound } from "@/lib/engine";
import { ingestNote, ingestPortalEmail } from "@/lib/intake";
import { syncFeed } from "@/lib/feed";
import { addPropertyFromNote, describeDraft } from "@/lib/property-voice";
import { LANGS, type Lang } from "@/lib/db/schema";

export type FormState = { error?: string; ok?: string } | undefined;

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "").trim();
  try {
    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.email, email)))[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return { error: "Email o contraseña incorrectos" };
    await createSession(user.id);
  } catch (err) {
    console.error("[ARM] Error en el login:", err);
    return { error: `No se pudo iniciar sesión: ${err instanceof Error ? err.message : "error del servidor"}` };
  }
  redirect("/app");
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  const agencyName = String(form.get("agency") ?? "").trim();
  const town = String(form.get("town") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!agencyName || !name || !email || password.length < 8) return { error: "Completa todos los campos (contraseña de 8+ caracteres)" };

  const db = await getDb();
  if ((await db.select().from(users).where(eq(users.email, email))).length) return { error: "Ese email ya tiene cuenta" };
  let slug = slugify(agencyName);
  if ((await db.select().from(agencies).where(eq(agencies.slug, slug))).length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const vertical: Vertical = form.get("vertical") === "vacacional" ? "vacacional" : "venta";
  const [agency] = await db.insert(agencies).values({ name: agencyName, slug, town, vertical }).returning();
  const [user] = await db.insert(users).values({
    agencyId: agency.id, email, name, role: "owner", passwordHash: await bcrypt.hash(password, 10),
  }).returning();
  await createSession(user.id);
  redirect("/app");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function createPropertyAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency } = await requireUser();
  const num = (k: string) => Number(form.get(k) ?? 0) || 0;
  const ref = String(form.get("ref") ?? "").trim().toUpperCase();
  const title = String(form.get("title") ?? "").trim();
  const town = String(form.get("town") ?? "").trim();
  const vacation = agency.vertical === "vacacional";
  if (!ref || !title || !town) return { error: "Referencia, título y pueblo son obligatorios" };
  if (vacation ? !num("maxGuests") : !num("price")) return { error: vacation ? "Indica cuántas personas caben" : "El precio es obligatorio" };

  const db = await getDb();
  if ((await db.select().from(properties).where(and(eq(properties.agencyId, agency.id), eq(properties.ref, ref)))).length)
    return { error: `Ya existe la referencia ${ref}` };
  const [property] = await db.insert(properties).values({
    agencyId: agency.id, ref, title, town,
    type: String(form.get("type") ?? "apartamento"),
    zone: String(form.get("zone") ?? "").trim(),
    price: num("price"), bedrooms: num("bedrooms"), bathrooms: num("bathrooms"), areaM2: num("area"),
    description: String(form.get("description") ?? "").trim(),
    features: String(form.get("features") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    maxGuests: num("maxGuests"),
    petsAllowed: ["si", "no"].includes(String(form.get("pets"))) ? String(form.get("pets")) : "consultar",
    bookingUrl: String(form.get("bookingUrl") ?? "").trim() || null,
    guestInfo: String(form.get("guestInfo") ?? "").trim(),
  }).returning();
  const notified = await matchNewProperty(agency, property);
  revalidatePath("/app/properties");
  return { ok: `${ref} creada. ${notified ? `La IA avisó a ${notified} cliente(s) a los que les encaja.` : "Ningún cliente en seguimiento encaja todavía."}` };
}

export async function setPropertyStatusAction(form: FormData) {
  const { agency } = await requireUser();
  const db = await getDb();
  await db.update(properties).set({ status: String(form.get("status")) })
    .where(and(eq(properties.id, String(form.get("id"))), eq(properties.agencyId, agency.id)));
  revalidatePath("/app/properties");
}

export async function setStageAction(form: FormData) {
  const { agency } = await requireUser();
  const stage = String(form.get("stage")) as Stage;
  if (!STAGES.includes(stage)) return;
  const id = String(form.get("id"));
  const db = await getDb();
  const lead = (await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.agencyId, agency.id))))[0];
  if (!lead) return;
  await db.update(leads).set({ stage, updatedAt: new Date(), ...(stage === "perdido" || stage === "cerrado" ? { nextFollowupAt: null } : {}) }).where(eq(leads.id, id));
  await logEvent(agency.id, id, "stage_changed", { from: lead.stage, to: stage, by: "agente" });
  revalidatePath(`/app/leads/${id}`);
  revalidatePath("/app/leads");
}

export async function toggleAiAction(form: FormData) {
  const { agency } = await requireUser();
  const id = String(form.get("id"));
  const paused = form.get("paused") === "1";
  const db = await getDb();
  await db.update(leads).set({ aiPaused: paused, ...(paused ? { nextFollowupAt: null } : {}) })
    .where(and(eq(leads.id, id), eq(leads.agencyId, agency.id)));
  await logEvent(agency.id, id, paused ? "ai_paused" : "ai_resumed");
  revalidatePath(`/app/leads/${id}`);
}

export async function agentReplyAction(form: FormData) {
  const { agency } = await requireUser();
  const id = String(form.get("id"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) return;
  const db = await getDb();
  const lead = (await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.agencyId, agency.id))))[0];
  if (!lead) return;
  await sendOutbound(agency, lead, body, "agent");
  revalidatePath(`/app/leads/${id}`);
}

export async function markGuestAction(form: FormData) {
  const { agency } = await requireUser();
  const id = String(form.get("id"));
  const propertyId = String(form.get("propertyId") ?? "");
  const db = await getDb();
  const lead = (await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.agencyId, agency.id))))[0];
  if (!lead) return;
  const prop = propertyId ? (await db.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))))[0] : undefined;
  await db.update(leads).set({
    guestPropertyId: prop?.id ?? null,
    stage: prop ? (lead.stage === "incidencia" ? "incidencia" : "huesped") : lead.stage === "huesped" ? "calificando" : lead.stage,
    nextFollowupAt: prop ? null : lead.nextFollowupAt,
    updatedAt: new Date(),
  }).where(eq(leads.id, id));
  await logEvent(agency.id, id, prop ? "guest_marked" : "stage_changed", prop ? { ref: prop.ref } : { from: lead.stage, to: "calificando" });
  revalidatePath(`/app/leads/${id}`);
}

export async function confirmVisitAction(form: FormData) {
  const { agency } = await requireUser();
  const db = await getDb();
  await db.update(visits).set({ status: String(form.get("status")) })
    .where(and(eq(visits.id, String(form.get("id"))), eq(visits.agencyId, agency.id)));
  revalidatePath(`/app/leads/${String(form.get("leadId"))}`);
}

export async function updateSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency, user } = await requireUser();
  if (user.role !== "owner") return { error: "Solo el propietario puede cambiar los ajustes" };
  const db = await getDb();
  const threshold = Math.max(30, Math.min(100, Number(form.get("threshold")) || 70));
  await db.update(agencies).set({
    name: String(form.get("name") ?? agency.name).trim() || agency.name,
    town: String(form.get("town") ?? "").trim(),
    assistantName: String(form.get("assistant") ?? "").trim() || "Sofía",
    agentPhone: String(form.get("agentPhone") ?? "").trim() || null,
    waPhoneNumberId: String(form.get("waId") ?? "").trim() || null,
    handoffThreshold: threshold,
    vertical: (["venta", "vacacional", "comercial"].includes(String(form.get("vertical"))) ? String(form.get("vertical")) : agency.vertical) as Vertical,
    knowledge: String(form.get("knowledge") ?? "").trim().slice(0, 20000),
    calendarIcsUrl: String(form.get("calendarIcsUrl") ?? "").trim() || null,
    workDays: form.getAll("workDays").map(String).filter((d) => /^[1-7]$/.test(d)).join(",") || agency.workDays,
    workHours: /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*\s*$/.test(String(form.get("workHours") ?? "")) ? String(form.get("workHours")).trim() : agency.workHours,
    visitMinutes: Math.max(15, Math.min(240, Number(form.get("visitMinutes")) || agency.visitMinutes)),
    feedUrl: String(form.get("feedUrl") ?? "").trim() || null,
  }).where(eq(agencies.id, agency.id));
  revalidatePath("/app", "layout");
  const newFeed = String(form.get("feedUrl") ?? "").trim();
  if (newFeed && newFeed !== agency.feedUrl) {
    const fresh = (await db.select().from(agencies).where(eq(agencies.id, agency.id)))[0];
    const r = await syncFeed(fresh);
    return r.ok ? { ok: `Ajustes guardados. CRM conectado: ${r.message}` } : { error: `Ajustes guardados, pero el feed falló: ${r.message}` };
  }
  return { ok: "Ajustes guardados" };
}

export async function addAgentUserAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency, user } = await requireUser();
  if (user.role !== "owner") return { error: "Solo el propietario puede añadir agentes" };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !name || password.length < 8) return { error: "Nombre, email y contraseña (8+) obligatorios" };
  const db = await getDb();
  if ((await db.select().from(users).where(eq(users.email, email))).length) return { error: "Ese email ya existe" };
  await db.insert(users).values({ agencyId: agency.id, email, name, role: "agent", passwordHash: await bcrypt.hash(password, 10) });
  revalidatePath("/app/settings");
  return { ok: `${name} ya puede entrar con ${email}` };
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "inmobiliaria";
}

export async function addNoteAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency } = await requireUser();
  const note = String(form.get("note") ?? "").trim();
  if (note.length < 10) return { error: "Escribe o dicta un poco más: quién es, qué busca y su teléfono." };
  const source = ["Llamada", "Visita a la oficina", "Otro"].includes(String(form.get("source"))) ? String(form.get("source")) : "Llamada";
  const lang = String(form.get("language") ?? "");
  let leadId: string;
  try {
    const { lead } = await ingestNote(agency, note, { source, language: LANGS.includes(lang as Lang) ? (lang as Lang) : undefined });
    leadId = lead.id;
  } catch (err) {
    console.error("[ARM] Error creando ficha desde nota:", err);
    return { error: "No se pudo crear la ficha. Inténtalo de nuevo." };
  }
  revalidatePath("/app/leads");
  redirect(`/app/leads/${leadId}?nuevo=1`);
}

export async function importEmailAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency } = await requireUser();
  const text = String(form.get("email") ?? "").trim();
  if (text.length < 20) return { error: "Pega el email completo del portal." };
  let leadId: string;
  try {
    const r = await ingestPortalEmail(agency, { text, subject: String(form.get("subject") ?? "") });
    if (!r.ok) return { error: r.error };
    leadId = r.lead.id;
  } catch (err) {
    console.error("[ARM] Error importando email:", err);
    return { error: "No se pudo importar el email. Inténtalo de nuevo." };
  }
  revalidatePath("/app/leads");
  redirect(`/app/leads/${leadId}?nuevo=1`);
}

export async function addPropertyVoiceAction(_: FormState, form: FormData): Promise<FormState> {
  const { agency } = await requireUser();
  const note = String(form.get("note") ?? "").trim();
  if (note.length < 15) return { error: "Dicta o escribe un poco más: tipo, zona, dormitorios, metros, precio…" };
  try {
    const { property, notified, missing } = await addPropertyFromNote(agency, note);
    revalidatePath("/app/properties");
    return {
      ok: `Creada: ${describeDraft(property)}.${missing.length ? ` Falta: ${missing.join(", ")} (complétalo abajo).` : ""} ${notified ? `La IA avisó a ${notified} cliente(s) a los que les encaja.` : ""}`,
    };
  } catch (err) {
    console.error("[ARM] Error en alta por voz:", err);
    return { error: "No se pudo crear la propiedad. Inténtalo de nuevo." };
  }
}

export async function syncFeedAction(_: FormState): Promise<FormState> {
  const { agency } = await requireUser();
  const r = await syncFeed(agency);
  revalidatePath("/app/properties");
  return r.ok ? { ok: r.message } : { error: r.message };
}

export async function updatePropertyAction(form: FormData) {
  const { agency } = await requireUser();
  const db = await getDb();
  const num = (k: string) => Number(form.get(k) ?? 0) || 0;
  await db.update(properties).set({
    price: num("price"), bedrooms: num("bedrooms"), areaM2: num("area"),
    title: String(form.get("title") ?? "").trim() || undefined,
  }).where(and(eq(properties.id, String(form.get("id"))), eq(properties.agencyId, agency.id)));
  revalidatePath("/app/properties");
}
