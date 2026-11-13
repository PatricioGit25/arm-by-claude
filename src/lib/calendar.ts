/**
 * Calendario de visitas sin OAuth:
 *  - Lectura: la "dirección secreta en formato iCal" del calendario del agente
 *    (Google Calendar, iCloud, Outlook) para saber cuándo está ocupado.
 *  - Escritura: el ARM publica un calendario .ics con las visitas agendadas al
 *    que el agente se suscribe una vez desde su Google Calendar / iPhone.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "./db";
import { leads, properties, visits, type Agency, type Lang } from "./db/schema";

// ---------- zona horaria ----------
function offsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - date.getTime()) / 60000;
}

/** Fecha/hora local de una zona → instante UTC. */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const off2 = offsetMinutes(new Date(t), tz);
  t = guess - off2 * 60000;
  return new Date(t);
}

export function localParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday")) + 1;
  return { y: +g("year"), m: +g("month"), d: +g("day"), h: +g("hour"), min: +g("minute"), weekday: wd };
}

const LOCALE: Record<Lang, string> = { es: "es-ES", en: "en-GB", sv: "sv-SE", de: "de-DE", fr: "fr-FR" };
export function formatSlot(date: Date, tz: string, lang: Lang = "es"): string {
  return new Intl.DateTimeFormat(LOCALE[lang] ?? "es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date);
}

// ---------- lectura de .ics ----------
export interface BusyRange { start: Date; end: Date }

function parseIcsDate(value: string, params: string, tz: string): { date: Date; allDay: boolean } | undefined {
  const v = value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { date: zoned(+m[1], +m[2], +m[3], 0, 0, tz), allDay: true };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return undefined;
  if (m[7] === "Z") return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), allDay: false };
  const tzid = params.match(/TZID=([^;:]+)/)?.[1]?.replace(/^"|"$/g, "");
  let zone = tz;
  if (tzid) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tzid });
      zone = tzid;
    } catch {
      zone = tz;
    }
  }
  return { date: zoned(+m[1], +m[2], +m[3], +m[4], +m[5], zone), allDay: false };
}

/**
 * Extrae los rangos ocupados de un calendario iCal. Los eventos repetitivos
 * (RRULE) se toman solo en su primera ocurrencia.
 */
export function parseIcs(ics: string, tz: string): BusyRange[] {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: BusyRange[] = [];
  let ev: Record<string, { params: string; value: string }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT" && ev) {
      const status = ev.STATUS?.value?.toUpperCase();
      const transp = ev.TRANSP?.value?.toUpperCase();
      const s = ev.DTSTART && parseIcsDate(ev.DTSTART.value, ev.DTSTART.params, tz);
      if (s && status !== "CANCELLED" && transp !== "TRANSPARENT") {
        const e = ev.DTEND && parseIcsDate(ev.DTEND.value, ev.DTEND.params, tz);
        const end = e?.date ?? new Date(s.date.getTime() + (s.allDay ? 86400000 : 3600000));
        out.push({ start: s.date, end });
      }
      ev = null;
    } else if (ev) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const head = line.slice(0, idx);
      const [name, ...params] = head.split(";");
      ev[name.toUpperCase()] = { params: params.join(";"), value: line.slice(idx + 1) };
    }
  }
  return out;
}

const icsCache = new Map<string, { at: number; busy: BusyRange[] }>();

async function externalBusy(agency: Agency): Promise<BusyRange[]> {
  const url = agency.calendarIcsUrl?.trim().replace(/^webcal:/i, "https:");
  if (!url) return [];
  const hit = icsCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.busy;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const busy = parseIcs(await res.text(), agency.timezone);
    icsCache.set(url, { at: Date.now(), busy });
    return busy;
  } catch (err) {
    console.error("[ARM] No se pudo leer el calendario del agente:", err);
    return hit?.busy ?? [];
  }
}

async function armBusy(agency: Agency, from: Date, to: Date): Promise<BusyRange[]> {
  const db = await getDb();
  const rows = await db.select().from(visits).where(and(
    eq(visits.agencyId, agency.id), inArray(visits.status, ["agendada", "confirmada"]),
    gte(visits.scheduledAt, new Date(from.getTime() - 86400000)), lte(visits.scheduledAt, to),
  ));
  return rows.filter((v) => v.scheduledAt).map((v) => ({ start: v.scheduledAt!, end: v.endsAt ?? new Date(v.scheduledAt!.getTime() + agency.visitMinutes * 60000) }));
}

// ---------- huecos libres ----------
export interface Slot { start: Date; end: Date }

function parseHours(s: string): [number, number][] {
  return s.split(",").map((r) => r.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)).filter(Boolean)
    .map((m) => [+m![1] * 60 + +m![2], +m![3] * 60 + +m![4]] as [number, number]);
}

export async function availableSlots(agency: Agency, opts: { from?: Date; days?: number; max?: number; partOfDay?: "morning" | "afternoon" } = {}): Promise<Slot[]> {
  const tz = agency.timezone;
  const now = new Date();
  const earliest = new Date(Math.max((opts.from ?? now).getTime(), now.getTime() + 2 * 3600000));
  const days = opts.days ?? 7;
  const max = opts.max ?? 6;
  const until = new Date(earliest.getTime() + days * 86400000);
  const busy = [...(await externalBusy(agency)), ...(await armBusy(agency, earliest, until))];
  const workDays = new Set(agency.workDays.split(",").map((d) => +d.trim()));
  const ranges = parseHours(agency.workHours);
  const len = agency.visitMinutes * 60000;
  const buffer = 15 * 60000;
  const out: Slot[] = [];
  const start = localParts(earliest, tz);
  for (let i = 0; i <= days && out.length < max; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    const lp = { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate() };
    const weekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (!workDays.has(weekday)) continue;
    let perDay = 0;
    for (const [a, b] of ranges) {
      if (opts.partOfDay === "morning" && a >= 14 * 60) continue;
      if (opts.partOfDay === "afternoon" && b <= 14 * 60) continue;
      for (let t = a; t + agency.visitMinutes <= b && perDay < 2 && out.length < max; t += agency.visitMinutes + 15) {
        const s = zoned(lp.y, lp.m, lp.d, Math.floor(t / 60), t % 60, tz);
        if (s < earliest) continue;
        const e = new Date(s.getTime() + len);
        const clash = busy.some((r) => s.getTime() < r.end.getTime() + buffer && e.getTime() + buffer > r.start.getTime());
        if (clash) continue;
        out.push({ start: s, end: e });
        perDay++;
        t += 90; // separa las opciones del mismo día
      }
    }
  }
  return out;
}

export async function isFree(agency: Agency, start: Date): Promise<boolean> {
  const end = new Date(start.getTime() + agency.visitMinutes * 60000);
  const busy = [...(await externalBusy(agency)), ...(await armBusy(agency, new Date(start.getTime() - 86400000), end))];
  return !busy.some((r) => start < r.end && end > r.start);
}

// ---------- exportación .ics ----------
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export async function exportIcs(agency: Agency): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(visits).where(and(eq(visits.agencyId, agency.id), inArray(visits.status, ["agendada", "confirmada", "hecha"])));
  const leadIds = [...new Set(rows.map((v) => v.leadId))];
  const propIds = [...new Set(rows.map((v) => v.propertyId).filter(Boolean))] as string[];
  const ls = leadIds.length ? await db.select().from(leads).where(inArray(leads.id, leadIds)) : [];
  const ps = propIds.length ? await db.select().from(properties).where(inArray(properties.id, propIds)) : [];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ARM by Claude//Visitas//ES", `X-WR-CALNAME:${esc(`Visitas ARM · ${agency.name}`)}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const v of rows) {
    if (!v.scheduledAt) continue;
    const lead = ls.find((l) => l.id === v.leadId);
    const prop = ps.find((p) => p.id === v.propertyId);
    const end = v.endsAt ?? new Date(v.scheduledAt.getTime() + agency.visitMinutes * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${v.id}@arm`,
      `DTSTAMP:${icsDate(v.createdAt)}`,
      `DTSTART:${icsDate(v.scheduledAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${esc(`Visita${v.status === "agendada" ? " (por confirmar)" : ""}: ${lead?.name ?? "Cliente"}${prop ? ` · ${prop.title}` : ""}`)}`,
      `DESCRIPTION:${esc([lead?.phone && `Teléfono: ${lead.phone}`, lead?.summary, prop && `${prop.ref} · ${prop.title}`].filter(Boolean).join("\n"))}`,
      ...(prop ? [`LOCATION:${esc(`${prop.zone ? `${prop.zone}, ` : ""}${prop.town}`)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
