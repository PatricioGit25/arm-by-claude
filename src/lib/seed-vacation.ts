/**
 * Demo de ALQUILER VACACIONAL basada en la web pública de South Costa (Nerja):
 * alojamientos, capacidades, normas y política de cancelación tal como aparecen
 * en southcostanerja.es. Los datos privados (códigos, wifi) son FICTICIOS.
 */
import bcrypt from "bcryptjs";
import type { DB } from "./db";
import { agencies, events, leads, messages, properties, users, type Lang, type LeadProfile, type Stage } from "./db/schema";
import { scoreLead } from "./scoring";

export const VACATION_SLUG = "south-costa-demo";
export const VACATION_DEMO_EMAIL = "demo-vacacional@arm.local";

const LODGIFY = "https://southcosta.lodgify.com/es/";

// [nombre, tipo, personas, m², características, slug de reserva en Lodgify | null]
const STAYS: [string, string, number, number, string[], string | null][] = [
  ["Casa Vacacional Torrecilla", "casa", 4, 120, ["terraza grande", "lavavajillas", "lavadora", "cama de matrimonio y 2 individuales"], "casa-torrecilla-en-el-centro-de-nerja---south-costa"],
  ["Estudio Brisa", "estudio", 2, 35, ["balcón", "piscina comunitaria", "lavadora", "ducha"], "estudio-brisa-en-el-centro-de-nerja---south-costa"],
  ["Estudio Buddha", "estudio", 2, 35, ["piscina comunitaria", "sofá cama para niño", "lavadora"], "estudio-buddha-en-el-centro-de-nerja---south-costa"],
  ["Estudio Bahia", "estudio", 2, 35, ["balcón", "bañera", "piscina comunitaria", "lavadora"], "estudio-bahia-en-el-centro-de-nerja---south-costa"],
  ["Estudio Costa", "estudio", 2, 35, ["piscina comunitaria", "sofá cama para niño", "lavadora"], "estudio-costa-en-el-centro-de-nerja---south-costa"],
  ["Estudio Caleta", "estudio", 2, 35, ["bañera", "lavavajillas", "sofá cama para niño", "piscina comunitaria"], null],
  ["Apartamento Chanquete", "apartamento", 4, 60, ["balcón grande", "lavavajillas", "cama de matrimonio y 2 individuales"], "apartamento-chanquete-en-el-centro-de-nerja---south-costa"],
  ["Apartamento Burriana", "apartamento", 4, 60, ["terraza grande", "piscina comunitaria", "lavavajillas", "sin ascensor"], "apartamento-burriana-en-el-centro-de-nerja---south-costa"],
  ["Apartamento Capistrano", "apartamento", 4, 70, ["terraza grande", "piscina comunitaria", "cama de matrimonio y sofá"], "casa-capistrano---south-costa"],
  ["Apartamento Castilla Pérez", "apartamento", 4, 70, ["piscina", "cama de matrimonio e individual"], null],
  ["Apartamento Faro", "apartamento", 4, 56, ["cama de matrimonio y 2 individuales", "lavadora"], "4249850/apartamento-faro---southcosta"],
  ["Nerja Perfect Getaway - Near Beach", "apartamento", 2, 40, ["vistas al mar", "piscina", "cama de 180 cm"], null],
  ["Torresol Sea View", "apartamento", 3, 50, ["frente a la piscina", "vistas al mar", "sofá cama"], "4267794/torresol-sea-view"],
  ["Acapulco Playa Beautiful SeaView", "apartamento", 2, 50, ["vistas al mar"], "4267793/acapulco-playa-beautiful-seaview"],
  ["Apartamento Alisio", "apartamento", 2, 30, ["balcón", "cama de matrimonio"], "4594705/apartamento-alisio-en-el-centro-de-nerja---south-costa"],
  ["Estudio Marina", "estudio", 2, 30, ["balcón", "cama de matrimonio"], "4594706/apartamento-marina-en-el-centro-de-nerja---south-costa"],
  ["Estudio Coralina", "estudio", 2, 35, ["balcón", "piscina", "cama de matrimonio"], "4757687/estudio-coralina---south-costa"],
  ["Casa La Noria", "casa", 4, 100, ["terraza", "piscina", "cama de matrimonio y 2 individuales"], "4622724/casa-la-noria"],
  ["Apartamento Duna", "apartamento", 4, 75, ["balcón", "2 camas de matrimonio"], "4594733/apartamento-duna-centro-de-nerja---south-costa"],
  ["Apartamento Arena", "apartamento", 4, 65, ["balcón", "cama de matrimonio y 2 individuales"], "4743343/apartamento-arena-centrico-y-comodo---south-costa"],
  ["Apartamento Océano", "apartamento", 4, 50, ["balcón", "2 camas individuales"], "4743437/apartamento-oceano---south-costa"],
  ["Apartamento Axarquía", "apartamento", 4, 92, ["balcón", "piscina", "cama de matrimonio y literas"], "4747130/apartamento-axarquia---south-costa"],
  ["Apartamento Corona", "apartamento", 3, 40, ["piscina", "cama de matrimonio y sofá cama"], "4478249/apartamento-corona-en-el-centro-de-nerja---south-costa"],
  ["Ático Las Terrazas", "atico", 4, 92, ["terraza", "cama de matrimonio y 2 individuales"], "4747148/atico-las-terrazas---south-costa"],
  ["Villa Almirante Torrecilla", "villa", 6, 80, [], null],
  ["Casa Playa Torrecilla", "casa", 5, 80, [], null],
  ["Apartamento Bahamas", "apartamento", 4, 50, [], null],
  ["Apartamento Marea", "apartamento", 4, 50, [], null],
];

export const SOUTH_COSTA_KNOWLEDGE = `Horarios: check-in a partir de las 16:00 y check-out hasta las 11:00. Entradas o salidas fuera de horario se pueden valorar, pero no se garantizan con antelación (decide el equipo).
Llegada: normalmente con cajetín de seguridad con código para las llaves; en algunos alojamientos, recepción presencial según la hora de llegada. Las instrucciones se envían por mensaje antes de llegar.
Incluido: ropa de cama, toallas, wifi gratuito, cocina equipada y pack de bienvenida (agua, café, papel higiénico, jabón y frutos secos).
Mascotas: se admiten en ciertos alojamientos, bajo petición, con suplemento de 10 € por noche y máximo 2 por alojamiento. Se añaden como extra al reservar.
Cuna: 10 € por noche, máximo 1 por alojamiento, según disponibilidad.
Parking: solo para estancias largas, bajo disponibilidad y con suplemento; no se reserva online.
No se puede fumar dentro de los alojamientos.
Consigna de equipaje en la oficina (Calle Castilla Pérez, 13, Nerja), con amplio horario.
Reservas y pagos: se paga el 50 % al reservar; el 50 % restante unos 15 días antes de la llegada. Cancelación gratuita con al menos 15 días de antelación; con menos, se cobra la reserva completa. Cambios de fecha gratis dentro del plazo de cancelación si hay disponibilidad, pagando la diferencia. No-show: se cobra el 100 %. No hay fianza, pero la tarjeta de garantía puede cargarse por daños.
Reservas directas: en la web oficial, con el enlace de cada alojamiento.
Atención durante la estancia: WhatsApp y teléfono, el equipo atiende las incidencias.`;

type DemoLead = {
  name: string; phone?: string; language: Lang; channel: string; source: string; stage: Stage; hoursAgo: number;
  profile: LeadProfile; summary?: string; guestOf?: string; convo: ["lead" | "ai", string][];
};

const LEADS: DemoLead[] = [
  {
    name: "Klaus Becker", phone: "+49 151 2345 6789", language: "de", channel: "whatsapp", source: "WhatsApp", stage: "listo", hoursAgo: 9,
    profile: { check_in: "2027-07-10", check_out: "2027-07-17", guests: 4, pets: false, property_ref: "SC-08", wants_booking: true },
    summary: "Familia alemana (2 adultos y 2 niños), del 10 al 17 de julio de 2027. Les interesa Apartamento Burriana (piscina). Quieren reservar directo: confirmar disponibilidad y precio.",
    convo: [
      ["lead", "Hallo! Wir suchen eine Wohnung in Nerja vom 10. bis 17. Juli, 2 Erwachsene und 2 Kinder. Gibt es einen Pool?"],
      ["ai", "Hallo Klaus! Für 4 Personen mit Pool passt das Apartamento Burriana sehr gut: große Terrasse und Gemeinschaftspool. Verfügbarkeit und Preis sehen Sie hier: https://southcosta.lodgify.com/es/apartamento-burriana-en-el-centro-de-nerja---south-costa"],
      ["lead", "Sehr schön! Wir möchten direkt buchen. Können Sie bestätigen, dass es frei ist?"],
      ["ai", "Sehr gerne! Ich gebe Ihre Anfrage an das Team weiter, es bestätigt Ihnen Verfügbarkeit und Preis in Kürze. 🙌"],
    ],
  },
  {
    name: "Emma Lindgren", phone: "+46 70 765 43 21", language: "sv", channel: "whatsapp", source: "Booking.com", stage: "huesped", hoursAgo: 3,
    profile: { guests: 2, property_ref: "SC-02" }, guestOf: "SC-02",
    convo: [
      ["lead", "Hej! Vi har precis kommit fram till Estudio Brisa. Vad är wifi-lösenordet?"],
      ["ai", "Hej Emma, välkomna till Nerja! ☀️ Wifi-nätverket heter SouthCosta_Brisa och lösenordet är Brisa2027 (demo). Säg till om ni behöver något mer!"],
    ],
  },
  {
    name: "Sarah Mitchell", phone: "+44 7700 900123", language: "en", channel: "whatsapp", source: "Airbnb", stage: "incidencia", hoursAgo: 1,
    profile: { guests: 3, property_ref: "SC-07" }, guestOf: "SC-07",
    summary: "Incidencia en Apartamento Chanquete: el aire acondicionado del salón no enfría.",
    convo: [
      ["lead", "Hi, the air conditioning in the living room at Apartamento Chanquete isn't working, it's really hot 🥵"],
      ["ai", "I'm so sorry about that, Sarah! I've let the team know and they'll message you shortly to sort it out."],
    ],
  },
  {
    name: "Julien Moreau", language: "fr", channel: "web", source: "Web", stage: "calificando", hoursAgo: 14,
    profile: { guests: 2, check_in: "2027-09-12", check_out: "2027-09-19" },
    convo: [
      ["lead", "Bonjour, nous cherchons un appartement avec vue sur la mer pour 2 personnes, du 12 au 19 septembre."],
      ["ai", "Bonjour Julien ! Avec vue sur la mer pour 2, je vous conseille Acapulco Playa Beautiful SeaView ou Torresol Sea View (face à la piscine). Les liens affichent la disponibilité et le prix exact. Voyagez-vous avec un animal ?"],
    ],
  },
  {
    name: "Lucía Fernández", language: "es", channel: "whatsapp", source: "Instagram", stage: "seguimiento", hoursAgo: 80,
    profile: { guests: 6, check_in: "2027-03-25", check_out: "2027-03-29" },
    convo: [
      ["lead", "Hola! Somos 6 para Semana Santa, del 25 al 29 de marzo. ¿Tenéis algo?"],
      ["ai", "¡Hola Lucía! Para 6 personas tenemos la Villa Almirante Torrecilla. El equipo te puede confirmar disponibilidad para esas fechas: ¿quieres que te lo miren?"],
    ],
  },
];

export async function seedVacation(db: DB): Promise<void> {
  const [agency] = await db.insert(agencies).values({
    slug: VACATION_SLUG,
    name: "South Costa (demo)",
    town: "Nerja",
    vertical: "vacacional",
    assistantName: "Lucía",
    knowledge: SOUTH_COSTA_KNOWLEDGE,
    languages: ["es", "en", "sv", "de", "fr"],
  }).returning();

  await db.insert(users).values({
    agencyId: agency.id, email: VACATION_DEMO_EMAIL, name: "Equipo South Costa (demo)", role: "owner",
    passwordHash: await bcrypt.hash("demo1234", 10),
  });

  const rows = await db.insert(properties).values(STAYS.map(([title, type, guests, m2, features, slug], i) => {
    const ref = `SC-${String(i + 1).padStart(2, "0")}`;
    const key = title.split(" ").slice(-1)[0].replace(/[^\p{L}]/gu, "");
    return {
      agencyId: agency.id, ref, title, type, price: 0, maxGuests: guests, areaM2: m2, town: "Nerja",
      zone: slug?.includes("centro") ? "Centro" : "", features, petsAllowed: "consultar",
      bookingUrl: slug ? LODGIFY + slug : null,
      guestInfo: `(DATOS DE EJEMPLO) Llaves en cajetín junto a la puerta, código 4821. Wifi: SouthCosta_${key} / clave ${key}2027. Basura: contenedores al final de la calle. Check-out hasta las 11:00: dejar las llaves en el cajetín.`,
    };
  })).returning();
  const byRef = new Map(rows.map((r) => [r.ref, r]));

  const now = Date.now();
  for (const d of LEADS) {
    const created = new Date(now - d.hoursAgo * 3600000);
    const inbound = d.convo.filter(([a]) => a === "lead").length;
    const { score } = scoreLead(d.profile, { inboundCount: inbound, hasContact: !!d.phone }, "vacacional");
    const [lead] = await db.insert(leads).values({
      agencyId: agency.id, name: d.name, phone: d.phone, language: d.language, channel: d.channel, source: d.source,
      stage: d.stage, score, profile: d.profile, summary: d.summary, inboundCount: inbound,
      createdAt: created, updatedAt: created, lastInboundAt: created, lastOutboundAt: created,
      guestPropertyId: d.guestOf ? byRef.get(d.guestOf)?.id : null,
      handedOffAt: d.stage === "listo" || d.stage === "incidencia" ? created : null,
      nextFollowupAt: d.stage === "seguimiento" || d.stage === "calificando" ? new Date(now + 86400000) : null,
    }).returning();
    let t = created.getTime();
    await db.insert(messages).values(d.convo.map(([who, body]) => ({
      agencyId: agency.id, leadId: lead.id, direction: who === "lead" ? ("in" as const) : ("out" as const),
      author: who, body, createdAt: new Date((t += 60000)),
    })));
    await db.insert(events).values({ agencyId: agency.id, leadId: lead.id, type: "lead_created", data: { source: d.source }, createdAt: created });
  }
}
