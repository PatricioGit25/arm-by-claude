import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export type Lang = "es" | "en" | "sv" | "de" | "fr";
export const LANGS: Lang[] = ["es", "en", "sv", "de", "fr"];

/** Tipo de negocio de la inmobiliaria. */
export type Vertical = "venta" | "vacacional" | "comercial";

export const STAGES = [
  "nuevo",
  "calificando",
  "seguimiento",
  "listo",
  "visita",
  "oferta",
  "cerrado",
  "perdido",
  // alquiler vacacional
  "reservado",
  "huesped",
  "incidencia",
] as const;
export type Stage = (typeof STAGES)[number];

export type Financing =
  | "contado"
  | "hipoteca_aprobada"
  | "hipoteca_pendiente"
  | "desconocido";

export interface LeadProfile {
  property_type?: string;
  bedrooms_min?: number;
  budget_max?: number;
  zones?: string[];
  timeline_months?: number;
  financing?: Financing;
  purpose?: string; // vivir, vacaciones, inversión, alquilar
  wants_visit?: boolean;
  notes?: string;
  // alquiler vacacional
  check_in?: string; // AAAA-MM-DD o texto
  check_out?: string;
  guests?: number;
  pets?: boolean;
  budget_night?: number;
  property_ref?: string;
  wants_booking?: boolean;
  offered_slots?: string[];
  // comercial (agencias interesadas en el ARM)
  company?: string;
  business_type?: string; // venta, alquiler vacacional, ambas
  team_size?: number;
  leads_month?: number;
  crm?: string;
  channels?: string; // huecos de visita ofrecidos (ISO) a la espera de que elija
}

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  town: text("town").notNull().default(""),
  languages: jsonb("languages").$type<Lang[]>().notNull().default(["es", "en", "sv"]),
  handoffThreshold: integer("handoff_threshold").notNull().default(70),
  agentPhone: text("agent_phone"),
  waPhoneNumberId: text("wa_phone_number_id"),
  assistantName: text("assistant_name").notNull().default("Sofía"),
  vertical: text("vertical").$type<Vertical>().notNull().default("venta"),
  knowledge: text("knowledge").notNull().default(""), // normas y preguntas frecuentes
  feedUrl: text("feed_url"), // feed XML del CRM (formato Kyero u otro)
  feedSyncedAt: timestamp("feed_synced_at", { withTimezone: true }),
  feedStatus: text("feed_status"),
  calendarIcsUrl: text("calendar_ics_url"), // dirección secreta iCal del calendario del agente (solo lectura)
  calendarToken: text("calendar_token").notNull().default(sql`md5(random()::text || clock_timestamp()::text || 'cal')`),
  workDays: text("work_days").notNull().default("1,2,3,4,5,6"), // 1=lunes ... 7=domingo
  workHours: text("work_hours").notNull().default("10:00-14:00,16:30-19:30"),
  visitMinutes: integer("visit_minutes").notNull().default(45),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  inboundToken: text("inbound_token").notNull().default(sql`md5(random()::text || clock_timestamp()::text)`), // buzón de emails de portales
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("agent"), // owner | agent
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  ref: text("ref").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(), // apartamento | atico | casa | villa | estudio | terreno
  price: integer("price").notNull(),
  bedrooms: integer("bedrooms").notNull().default(0),
  bathrooms: integer("bathrooms").notNull().default(0),
  areaM2: integer("area_m2").notNull().default(0),
  town: text("town").notNull(),
  zone: text("zone").notNull().default(""),
  description: text("description").notNull().default(""),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("disponible"), // disponible | reservada | vendida
  maxGuests: integer("max_guests").notNull().default(0),
  petsAllowed: text("pets_allowed").notNull().default("consultar"), // si | no | consultar
  bookingUrl: text("booking_url"),
  guestInfo: text("guest_info").notNull().default(""), // privado: solo para huéspedes confirmados
  externalId: text("external_id"), // id en el CRM (feed)
  ownerContact: text("owner_contact"), // privado: propietario
  imageUrl: text("image_url"),
  origin: text("origin").notNull().default("manual"), // manual | feed | voz
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  externalId: text("external_id"), // id de canal (wa_id, visitor id...)
  language: text("language").$type<Lang>().notNull().default("es"),
  channel: text("channel").notNull().default("web"), // web | whatsapp | portal | email
  source: text("source"), // Idealista, Instagram, web...
  stage: text("stage").$type<Stage>().notNull().default("nuevo"),
  score: integer("score").notNull().default(0),
  profile: jsonb("profile").$type<LeadProfile>().notNull().default({}),
  summary: text("summary"),
  aiPaused: boolean("ai_paused").notNull().default(false),
  assignedUserId: uuid("assigned_user_id"),
  inboundCount: integer("inbound_count").notNull().default(0),
  followupCount: integer("followup_count").notNull().default(0),
  nextFollowupAt: timestamp("next_followup_at", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
  lostReason: text("lost_reason"),
  guestPropertyId: uuid("guest_property_id"), // huésped confirmado de esta propiedad
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  direction: text("direction").$type<"in" | "out">().notNull(),
  author: text("author").$type<"lead" | "ai" | "agent" | "system">().notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  leadId: uuid("lead_id"),
  type: text("type").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const visits = pgTable("visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  propertyId: uuid("property_id"),
  preferredTime: text("preferred_time").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: text("status").notNull().default("pendiente"), // pendiente | confirmada | hecha | cancelada
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  leadId: uuid("lead_id"),
  kind: text("kind").notNull(), // handoff | visit | summary
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Agency = typeof agencies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Message = typeof messages.$inferSelect;
