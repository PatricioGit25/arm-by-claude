import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import type { DB } from "./db";
import { agencies, users, properties, leads, messages, events, type LeadProfile, type Stage, type Lang } from "./db/schema";
import { scoreLead } from "./scoring";

export const DEMO_EMAIL = "demo@arm.local";
export const DEMO_PASSWORD = "demo1234";

const PROPS = [
  { ref: "NJ-101", title: "Apartamento con vistas al mar en Burriana", type: "apartamento", price: 285000, bedrooms: 2, bathrooms: 2, areaM2: 85, town: "Nerja", zone: "Burriana", features: ["vistas al mar", "terraza", "piscina comunitaria", "a 300 m de la playa"], description: "Luminoso apartamento reformado a pocos minutos andando de la playa de Burriana. Terraza orientada al sur con vistas al mar." },
  { ref: "NJ-102", title: "Ático en el centro de Nerja, junto al Balcón de Europa", type: "atico", price: 345000, bedrooms: 2, bathrooms: 1, areaM2: 78, town: "Nerja", zone: "Centro", features: ["solárium", "vistas al mar", "ascensor"], description: "Ático con solárium privado a 2 minutos del Balcón de Europa. Ideal para vivir todo el año o como segunda residencia." },
  { ref: "NJ-103", title: "Estudio reformado cerca de la playa", type: "estudio", price: 149000, bedrooms: 0, bathrooms: 1, areaM2: 38, town: "Nerja", zone: "Torrecilla", features: ["reformado", "a 200 m de la playa", "alquiler turístico"], description: "Estudio totalmente reformado, perfecto como inversión para alquiler vacacional." },
  { ref: "NJ-104", title: "Apartamento familiar de 3 dormitorios en Parador", type: "apartamento", price: 239000, bedrooms: 3, bathrooms: 2, areaM2: 105, town: "Nerja", zone: "Parador", features: ["garaje", "trastero", "piscina comunitaria"], description: "Amplio apartamento con garaje y trastero en urbanización con piscina. Cerca de colegios y supermercados." },
  { ref: "FR-201", title: "Casa de pueblo en Frigiliana con terraza", type: "casa", price: 265000, bedrooms: 3, bathrooms: 2, areaM2: 120, town: "Frigiliana", zone: "Casco antiguo", features: ["terraza", "vistas a la montaña", "encanto andaluz"], description: "Casa típica andaluza en el casco antiguo de Frigiliana, uno de los pueblos más bonitos de España." },
  { ref: "FR-202", title: "Villa con piscina privada y vistas panorámicas", type: "villa", price: 690000, bedrooms: 4, bathrooms: 3, areaM2: 240, town: "Frigiliana", zone: "Las Lomas", features: ["piscina privada", "vistas al mar", "parcela 1.200 m²", "barbacoa"], description: "Villa independiente con piscina privada y vistas al mar y a la montaña. A 10 minutos de Nerja." },
  { ref: "TX-301", title: "Adosado en Torrox Costa a 500 m de la playa", type: "casa", price: 315000, bedrooms: 3, bathrooms: 2, areaM2: 130, town: "Torrox", zone: "Torrox Costa", features: ["jardín", "piscina comunitaria", "garaje"], description: "Adosado de tres plantas con jardín privado, piscina comunitaria y garaje." },
  { ref: "TX-302", title: "Apartamento de 1 dormitorio en primera línea", type: "apartamento", price: 189000, bedrooms: 1, bathrooms: 1, areaM2: 55, town: "Torrox", zone: "Torrox Costa", features: ["primera línea", "vistas al mar", "alquiler turístico"], description: "Apartamento en primera línea de playa con licencia turística." },
  { ref: "MR-401", title: "Villa de lujo en Maro con acceso a calas", type: "villa", price: 1250000, bedrooms: 5, bathrooms: 5, areaM2: 380, town: "Nerja", zone: "Maro", features: ["piscina infinita", "vistas al mar", "domótica", "casa de invitados"], description: "Villa contemporánea en Maro, junto al paraje natural de los Acantilados de Maro-Cerro Gordo." },
  { ref: "NJ-105", title: "Apartamento de 2 dormitorios en El Capistrano", type: "apartamento", price: 199000, bedrooms: 2, bathrooms: 1, areaM2: 70, town: "Nerja", zone: "Capistrano", features: ["piscina comunitaria", "jardines", "vistas al mar"], description: "Apartamento en el popular complejo Capistrano, con jardines tropicales y piscinas." },
];

type DemoLead = {
  name: string; phone?: string; email?: string; language: Lang; channel: string; source: string;
  stage: Stage; daysAgo: number; profile: LeadProfile; summary?: string;
  convo: [("lead" | "ai"), string][];
};

const DEMO_LEADS: DemoLead[] = [
  {
    name: "Erik Lindqvist", phone: "+46 70 123 45 67", language: "sv", channel: "whatsapp", source: "Idealista",
    stage: "listo", daysAgo: 0,
    profile: { property_type: "apartamento", bedrooms_min: 2, budget_max: 300000, zones: ["Nerja"], timeline_months: 3, financing: "contado", purpose: "segunda residencia", wants_visit: true },
    summary: "Sueco, compra al contado, busca apartamento de 2 dormitorios en Nerja hasta 300.000 €. Quiere comprar antes de 3 meses y visitar NJ-101 el sábado por la mañana.",
    convo: [
      ["lead", "Hej! Jag såg lägenheten i Burriana på Idealista. Är den fortfarande till salu?"],
      ["ai", "Hej Erik! Ja, NJ-101 i Burriana är fortfarande tillgänglig: 2 sovrum, terrass i söderläge med havsutsikt, 285 000 €. Letar ni efter ett fritidsboende eller för att bo året runt?"],
      ["lead", "Fritidsboende, vi kommer ner flera gånger om året. Vi betalar kontant, budget max 300 000."],
      ["ai", "Perfekt, då passar den bra. När skulle ni vilja köpa? Och vill ni boka en visning?"],
      ["lead", "Gärna inom 2-3 månader. Vi är i Nerja nästa lördag, kan vi se den då på förmiddagen?"],
      ["ai", "Toppen! Jag bokar en visning lördag förmiddag och vår mäklare hör av sig för att bekräfta tiden. 🏡"],
    ],
  },
  {
    name: "Laura Martín", phone: "+34 611 22 33 44", language: "es", channel: "web", source: "Web",
    stage: "calificando", daysAgo: 0,
    profile: { property_type: "casa", bedrooms_min: 3, budget_max: 280000, zones: ["Frigiliana"], financing: "hipoteca_pendiente" },
    convo: [
      ["lead", "Hola, busco una casa de 3 habitaciones por Frigiliana"],
      ["ai", "¡Hola Laura! Tengo una que te puede encantar: FR-201, casa de pueblo en el casco antiguo de Frigiliana, 3 dormitorios con terraza, 265.000 €. ¿Qué presupuesto manejas?"],
      ["lead", "Hasta 280 mil más o menos, estamos viendo la hipoteca con el banco"],
      ["ai", "¡Genial, encaja! ¿Para cuándo os gustaría mudaros?"],
    ],
  },
  {
    name: "James Whitaker", email: "james.w@example.com", language: "en", channel: "portal", source: "Rightmove",
    stage: "seguimiento", daysAgo: 6,
    profile: { property_type: "villa", budget_max: 750000, zones: ["Frigiliana", "Nerja"], timeline_months: 12, financing: "hipoteca_pendiente", purpose: "jubilación" },
    convo: [
      ["lead", "Hi, we're looking for a villa with a private pool around Nerja, budget up to 750k."],
      ["ai", "Hi James! FR-202 could be a great fit: 4-bed villa in Frigiliana with private pool and sea views, €690,000. When are you planning to buy?"],
      ["lead", "Probably next year, once we sell our house in the UK."],
      ["ai", "Makes sense! I'll keep you posted on new villas that match. Would you like to see FR-202 next time you're in the area?"],
    ],
  },
  {
    name: "Anna Svensson", phone: "+46 73 555 12 12", language: "sv", channel: "whatsapp", source: "Instagram",
    stage: "visita", daysAgo: 2,
    profile: { property_type: "atico", bedrooms_min: 2, budget_max: 360000, zones: ["Nerja"], timeline_months: 2, financing: "hipoteca_aprobada", wants_visit: true },
    summary: "Busca ático en el centro de Nerja hasta 360.000 €, hipoteca aprobada en banco sueco. Visita a NJ-102 agendada.",
    convo: [
      ["lead", "Hej, finns det takvåningar nära Balcón de Europa?"],
      ["ai", "Hej Anna! Ja, NJ-102: takvåning med privat solterrass, 2 min från Balcón de Europa, 345 000 €. Vill du boka en visning?"],
    ],
  },
  {
    name: "Carlos Ruiz", phone: "+34 622 98 76 54", language: "es", channel: "whatsapp", source: "Idealista",
    stage: "seguimiento", daysAgo: 4,
    profile: { property_type: "estudio", budget_max: 160000, purpose: "inversión" },
    convo: [
      ["lead", "Buenas, ¿el estudio de Torrecilla tiene licencia turística?"],
      ["ai", "¡Hola Carlos! NJ-103 está a 200 m de la playa y es ideal para alquiler vacacional. ¿Lo buscas como inversión?"],
      ["lead", "Sí, inversión. Máximo 160k"],
      ["ai", "Perfecto. ¿Tienes pensado comprar en los próximos meses o estás valorando opciones a más largo plazo?"],
    ],
  },
  {
    name: "Sophie Turner", language: "en", channel: "web", source: "Web",
    stage: "nuevo", daysAgo: 0, profile: {},
    convo: [["lead", "Hello! Do you have anything with 3 bedrooms near the beach?"]],
  },
  {
    name: "Mikael Berg", language: "sv", channel: "portal", source: "Hemnet",
    stage: "perdido", daysAgo: 20,
    profile: { property_type: "apartamento", budget_max: 150000 },
    convo: [
      ["lead", "Hej, har ni lägenheter under 150 000 €?"],
      ["ai", "Hej Mikael! Just nu har vi NJ-103, en studio på 149 000 €. Vill du ha mer information?"],
    ],
  },
];

export async function seedIfEmpty(db: DB): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(agencies);
  if (count > 0 || process.env.ARM_SKIP_SEED === "1") return;

  const [agency] = await db
    .insert(agencies)
    .values({ slug: "costa-nerja", name: "Costa Nerja Homes", town: "Nerja", agentPhone: "+34 600 000 000", assistantName: "Sofía" })
    .returning();

  await db.insert(users).values({
    agencyId: agency.id,
    email: DEMO_EMAIL,
    name: "Marta (demo)",
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    role: "owner",
  });

  await db.insert(properties).values(PROPS.map((p) => ({ ...p, agencyId: agency.id })));

  const now = Date.now();
  for (const d of DEMO_LEADS) {
    const created = new Date(now - d.daysAgo * 86400000 - 3600000 * 3);
    const inbound = d.convo.filter(([a]) => a === "lead").length;
    const { score } = scoreLead(d.profile, { inboundCount: inbound, hasContact: !!(d.phone || d.email) });
    const handed = ["listo", "visita"].includes(d.stage);
    const [lead] = await db
      .insert(leads)
      .values({
        agencyId: agency.id, name: d.name, phone: d.phone, email: d.email, language: d.language,
        channel: d.channel, source: d.source, stage: d.stage, score, profile: d.profile, summary: d.summary,
        inboundCount: inbound, createdAt: created, updatedAt: created,
        lastInboundAt: created, lastOutboundAt: created,
        aiPaused: handed, handedOffAt: handed ? created : null,
        nextFollowupAt: d.stage === "seguimiento" ? new Date(now + 86400000) : null,
        lostReason: d.stage === "perdido" ? "Sin respuesta tras 4 seguimientos" : null,
      })
      .returning();
    let t = created.getTime();
    await db.insert(messages).values(
      d.convo.map(([who, body]) => ({
        agencyId: agency.id, leadId: lead.id, direction: who === "lead" ? ("in" as const) : ("out" as const),
        author: who, body, createdAt: new Date((t += 90000)),
      })),
    );
    await db.insert(events).values({ agencyId: agency.id, leadId: lead.id, type: "lead_created", data: { source: d.source }, createdAt: created });
    if (handed) {
      await db.insert(events).values({ agencyId: agency.id, leadId: lead.id, type: "handoff", data: { summary: d.summary }, createdAt: new Date(t) });
    }
  }
}
