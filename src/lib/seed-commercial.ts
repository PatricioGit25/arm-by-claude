/**
 * Cuenta de VistaAlta: su propio ARM atiende a las agencias que piden una demo.
 * El acceso del dueño se crea con ARM_ADMIN_EMAIL y ARM_ADMIN_PASSWORD (Vercel),
 * nunca con una contraseña fija en el código.
 */
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import { agencies, users } from "./db/schema";

export const SALES_SLUG = "vistaalta";

export const PRODUCT_KNOWLEDGE = `Qué es: ARM (Automated Relationship Manager) by VistaAlta. Un asistente con IA para inmobiliarias y empresas de alquiler vacacional que atiende a cada cliente al momento, 24/7, por WhatsApp y la web.
Qué hace:
- Responde al instante en el idioma del cliente: español, inglés, sueco, alemán y francés.
- Califica conversando (qué busca, zona, presupuesto, plazos, financiación) y pasa al equipo solo a quien va en serio, con todo resumido.
- Agenda visitas en huecos libres reales del calendario del agente.
- Hace seguimiento automático y avisa cuando entra una propiedad que encaja.
- Recoge solos los contactos de Idealista, Fotocasa, Kyero… (en 1 minuto) y los de llamadas o visitas a la oficina (dictando una frase).
- Lee el catálogo del CRM que ya usan (feed XML de Inmovilla, Witei, Mobilia…), sin cambiar de programa.
- "Tu día": a quién llamar primero y resumen en audio cada mañana.
- Alta de propiedades por voz, con descripción en varios idiomas.
- Alquiler vacacional: atención a huéspedes 24/7, códigos y wifi solo para huéspedes confirmados, incidencias urgentes al momento y reservas directas sin comisión de portales.
Condiciones:
- Prueba piloto de 30 días sin coste.
- Después, 99 € al mes por agencia, sin permanencia. Alta y configuración gratis, hechas en persona en la zona (Costa del Sol).
- El coste de WhatsApp Business que cobra Meta va aparte y depende del uso; cuando el cliente escribe primero suele ser muy bajo.
- Agencias con mucho volumen, varias oficinas o necesidades especiales: precio a medida.
- También se puede combinar con web o vídeo para la agencia (VistaAlta), con presupuesto aparte.
Quién está detrás: VistaAlta, estudio con base en Nerja.`;

export async function seedCommercial(db: DB): Promise<void> {
  await db.insert(agencies).values({
    slug: SALES_SLUG, name: "VistaAlta", town: "Nerja", vertical: "comercial", assistantName: "Vega",
    knowledge: PRODUCT_KNOWLEDGE, visitMinutes: 30, handoffThreshold: 70, languages: ["es", "en", "sv", "de", "fr"],
  });
}

/** Crea o actualiza el acceso del dueño de VistaAlta a partir de las variables de entorno. */
export async function ensureAdmin(db: DB): Promise<void> {
  const email = process.env.ARM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ARM_ADMIN_PASSWORD?.trim();
  if (!email || !password) return;
  if (password.length < 8) {
    console.error("[ARM] ARM_ADMIN_PASSWORD debe tener al menos 8 caracteres: no se crea el acceso");
    return;
  }
  const agency = (await db.select().from(agencies).where(eq(agencies.slug, SALES_SLUG)))[0];
  if (!agency) return;
  // Solo se aplica cuando la variable cambia: si el dueño cambia la contraseña
  // desde el panel, no se pisa hasta que cambie ARM_ADMIN_PASSWORD en Vercel.
  const sha = createHash("sha256").update(password).digest("hex");
  const existing = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (existing) {
    if (existing.envPasswordSha !== sha) {
      await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10), envPasswordSha: sha }).where(eq(users.id, existing.id));
    }
    return;
  }
  await db.insert(users).values({ agencyId: agency.id, email, name: "VistaAlta", role: "owner", passwordHash: await bcrypt.hash(password, 10), envPasswordSha: sha });
}

/** Estado del acceso del dueño, sin revelar datos (para /api/health). */
export async function adminStatus(db: DB): Promise<string> {
  const email = process.env.ARM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ARM_ADMIN_PASSWORD?.trim();
  if (!email && !password) return "sin configurar (faltan ARM_ADMIN_EMAIL y ARM_ADMIN_PASSWORD)";
  if (!email) return "falta ARM_ADMIN_EMAIL";
  if (!password) return "falta ARM_ADMIN_PASSWORD";
  if (password.length < 8) return "la contraseña tiene menos de 8 caracteres";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "ARM_ADMIN_EMAIL no parece un email válido";
  const u = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (!u) return "configurado, pero el usuario aún no existe (vuelve a publicar)";
  if (await bcrypt.compare(password, u.passwordHash)) return "listo: puedes entrar con ese email y la contraseña de ARM_ADMIN_PASSWORD";
  return u.envPasswordSha === createHash("sha256").update(password).digest("hex")
    ? "listo: la contraseña se cambió desde el panel (para restablecerla, cambia ARM_ADMIN_PASSWORD y vuelve a publicar)"
    : "el usuario existe, pero la contraseña aún no se actualizó (vuelve a publicar)";
}
