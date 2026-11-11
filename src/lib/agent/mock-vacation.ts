/**
 * Agente de reglas (modo demo, sin API key) para ALQUILER VACACIONAL.
 * Atiende dos casos: gente que busca alojamiento y huéspedes con reserva.
 */
import type { Lang, LeadProfile, Property } from "../db/schema";
import { detectLang } from "../i18n";
import { norm } from "../scoring";
import { findProperty, searchCatalog } from "./tools";
import { emptyTurnState, type AgentInput, type AgentOutput } from "./types";

type Key =
  | "greet" | "ask_dates" | "ask_guests" | "ask_pets" | "options" | "none" | "link"
  | "offer_team" | "handoff" | "times" | "need_booking_name" | "your_info" | "which_property"
  | "incident" | "incident_urgent" | "thanks";

const T: Record<Lang, Record<Key, string>> = {
  es: {
    greet: "¡Hola! Soy {a}, de {g}. 😊",
    ask_dates: "¿Para qué fechas buscas alojamiento?",
    ask_guests: "¿Cuántas personas seríais?",
    ask_pets: "¿Viajáis con mascota?",
    options: "Estos alojamientos encajan con lo que buscas:",
    none: "Ahora mismo no tengo un alojamiento que encaje del todo; se lo paso al equipo para que te propongan algo.",
    link: "En el enlace puedes ver la disponibilidad y el precio exacto para tus fechas.",
    offer_team: "¿Quieres que el equipo te confirme disponibilidad y precio?",
    handoff: "¡Perfecto! Le paso tu consulta al equipo y te confirman disponibilidad y precio muy pronto. 🙌",
    times: "El check-in es a partir de las 16:00 y el check-out hasta las 11:00.",
    need_booking_name: "Para enviarte los códigos de acceso y el wifi necesito confirmar tu reserva: ¿a nombre de quién está? Aviso al equipo ahora mismo.",
    your_info: "Aquí tienes la información de tu alojamiento:",
    which_property: "¿En qué alojamiento estás?",
    incident: "¡Siento mucho las molestias! Ya he avisado al equipo y te escriben enseguida para solucionarlo.",
    incident_urgent: "¡Lo siento mucho! He avisado al equipo como URGENTE y te contactan en minutos. Si hay cualquier peligro, llama al 112.",
    thanks: "¡Gracias! Si necesitas cualquier cosa, aquí estoy, a cualquier hora.",
  },
  en: {
    greet: "Hi! I'm {a} from {g}. 😊",
    ask_dates: "Which dates are you looking for?",
    ask_guests: "How many people will be staying?",
    ask_pets: "Are you travelling with a pet?",
    options: "These places match what you're looking for:",
    none: "I don't have a perfect match right now; I'll pass it to the team so they can suggest something.",
    link: "The link shows live availability and the exact price for your dates.",
    offer_team: "Would you like the team to confirm availability and price for you?",
    handoff: "Perfect! I'm passing your request to the team and they'll confirm availability and price very soon. 🙌",
    times: "Check-in is from 4 pm and check-out is until 11 am.",
    need_booking_name: "To send you the access codes and wifi I need to confirm your booking: what name is it under? I'm letting the team know right now.",
    your_info: "Here's the information for your accommodation:",
    which_property: "Which accommodation are you staying in?",
    incident: "I'm so sorry about that! I've let the team know and they'll message you shortly to sort it out.",
    incident_urgent: "I'm so sorry! I've flagged this as URGENT and the team will contact you within minutes. If there's any danger, call 112.",
    thanks: "Thank you! I'm here any time if you need anything.",
  },
  sv: {
    greet: "Hej! Jag heter {a} och jobbar på {g}. 😊",
    ask_dates: "Vilka datum letar ni boende för?",
    ask_guests: "Hur många personer blir ni?",
    ask_pets: "Har ni med er husdjur?",
    options: "De här boendena passar det ni söker:",
    none: "Just nu har jag inget som passar helt; jag skickar det vidare till teamet så att de kan föreslå något.",
    link: "I länken ser du tillgänglighet och exakt pris för era datum.",
    offer_team: "Vill du att teamet bekräftar tillgänglighet och pris?",
    handoff: "Perfekt! Jag skickar er förfrågan till teamet så bekräftar de tillgänglighet och pris mycket snart. 🙌",
    times: "Incheckning från kl. 16:00 och utcheckning senast kl. 11:00.",
    need_booking_name: "För att skicka koder och wifi behöver jag bekräfta er bokning: vilket namn står den på? Jag meddelar teamet direkt.",
    your_info: "Här är informationen om ert boende:",
    which_property: "Vilket boende bor ni i?",
    incident: "Så tråkigt, förlåt! Jag har meddelat teamet och de skriver till er inom kort.",
    incident_urgent: "Förlåt! Jag har markerat det som AKUT och teamet kontaktar er inom några minuter. Vid fara, ring 112.",
    thanks: "Tack! Jag finns här dygnet runt om ni behöver något.",
  },
  de: {
    greet: "Hallo! Ich bin {a} von {g}. 😊",
    ask_dates: "Für welche Daten suchen Sie eine Unterkunft?",
    ask_guests: "Wie viele Personen sind Sie?",
    ask_pets: "Reisen Sie mit Haustier?",
    options: "Diese Unterkünfte passen zu Ihrer Suche:",
    none: "Gerade habe ich nichts, was genau passt; ich gebe es an das Team weiter, damit es Ihnen etwas vorschlägt.",
    link: "Über den Link sehen Sie Verfügbarkeit und genauen Preis für Ihre Daten.",
    offer_team: "Soll das Team Ihnen Verfügbarkeit und Preis bestätigen?",
    handoff: "Perfekt! Ich gebe Ihre Anfrage an das Team weiter, es bestätigt Ihnen Verfügbarkeit und Preis sehr bald. 🙌",
    times: "Check-in ab 16:00 Uhr, Check-out bis 11:00 Uhr.",
    need_booking_name: "Um Ihnen Zugangscodes und WLAN zu schicken, muss ich Ihre Buchung bestätigen: Auf welchen Namen läuft sie? Ich informiere sofort das Team.",
    your_info: "Hier die Informationen zu Ihrer Unterkunft:",
    which_property: "In welcher Unterkunft wohnen Sie?",
    incident: "Das tut mir sehr leid! Ich habe das Team informiert, es meldet sich gleich bei Ihnen.",
    incident_urgent: "Das tut mir sehr leid! Ich habe es als DRINGEND markiert, das Team meldet sich in wenigen Minuten. Bei Gefahr rufen Sie 112 an.",
    thanks: "Danke! Ich bin jederzeit für Sie da.",
  },
  fr: {
    greet: "Bonjour ! Je suis {a}, de {g}. 😊",
    ask_dates: "Pour quelles dates cherchez-vous un logement ?",
    ask_guests: "Combien de personnes serez-vous ?",
    ask_pets: "Voyagez-vous avec un animal ?",
    options: "Ces logements correspondent à votre recherche :",
    none: "Je n'ai rien qui corresponde parfaitement pour l'instant ; je transmets à l'équipe pour qu'elle vous propose quelque chose.",
    link: "Le lien affiche la disponibilité et le prix exact pour vos dates.",
    offer_team: "Voulez-vous que l'équipe vous confirme la disponibilité et le prix ?",
    handoff: "Parfait ! Je transmets votre demande à l'équipe, qui vous confirme disponibilité et prix très vite. 🙌",
    times: "Le check-in est à partir de 16h et le check-out jusqu'à 11h.",
    need_booking_name: "Pour vous envoyer les codes d'accès et le wifi, je dois confirmer votre réservation : à quel nom est-elle ? Je préviens l'équipe tout de suite.",
    your_info: "Voici les informations de votre logement :",
    which_property: "Dans quel logement séjournez-vous ?",
    incident: "Je suis vraiment désolée ! J'ai prévenu l'équipe, elle vous écrit tout de suite.",
    incident_urgent: "Je suis vraiment désolée ! J'ai signalé cela comme URGENT, l'équipe vous contacte dans quelques minutes. En cas de danger, appelez le 112.",
    thanks: "Merci ! Je suis là à toute heure si vous avez besoin.",
  },
};

const MONTHS: Record<string, number> = {
  enero: 1, january: 1, jan: 1, januari: 1, januar: 1, janvier: 1,
  febrero: 2, february: 2, feb: 2, februari: 2, februar: 2, fevrier: 2,
  marzo: 3, march: 3, mars: 3, mar: 3, marz: 3,
  abril: 4, april: 4, apr: 4, avril: 4,
  mayo: 5, may: 5, maj: 5, mai: 5,
  junio: 6, june: 6, jun: 6, juni: 6, juin: 6,
  julio: 7, july: 7, jul: 7, juli: 7, juillet: 7,
  agosto: 8, august: 8, aug: 8, augusti: 8, aout: 8,
  septiembre: 9, september: 9, sep: 9, sept: 9, septembre: 9,
  octubre: 10, october: 10, oct: 10, oktober: 10, octobre: 10,
  noviembre: 11, november: 11, nov: 11, novembre: 11,
  diciembre: 12, december: 12, dec: 12, dezember: 12, decembre: 12,
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function yearFor(m: number, d: number, today = new Date()): number {
  const y = today.getFullYear();
  return new Date(y, m - 1, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate()) ? y + 1 : y;
}

/** "del 10 al 17 de agosto", "10-17 August", "10/08 - 17/08", "August 10 to 17" */
export function extractDates(raw: string): { check_in?: string; check_out?: string } {
  const t = norm(raw).replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const monthRe = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  let m = t.match(new RegExp(`(\\d{1,2})\\.?\\s*(?:-|al|to|till|bis|au|a|–)\\s*(\\d{1,2})\\.?\\s*(?:de |of )?\\s*(${monthRe})\\b`));
  if (m) {
    const mo = MONTHS[m[3]], d1 = +m[1], d2 = +m[2], y = yearFor(mo, d1);
    return { check_in: iso(y, mo, d1), check_out: iso(d2 < d1 ? y + (mo === 12 ? 1 : 0) : y, d2 < d1 ? (mo % 12) + 1 : mo, d2) };
  }
  m = t.match(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})\\s*(?:-|to|till|bis|au|al|–)\\s*(\\d{1,2})\\b`));
  if (m) {
    const mo = MONTHS[m[1]], d1 = +m[2], d2 = +m[3], y = yearFor(mo, d1);
    return { check_in: iso(y, mo, d1), check_out: iso(y, mo, d2) };
  }
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.]\d{2,4})?\s*(?:-|al|to|till|bis|au|a|–)\s*(\d{1,2})[/.](\d{1,2})/);
  if (m) {
    const y = yearFor(+m[2], +m[1]);
    return { check_in: iso(y, +m[2], +m[1]), check_out: iso(+m[4] < +m[2] ? y + 1 : y, +m[4], +m[3]) };
  }
  return {};
}

export function extractGuests(raw: string): number | undefined {
  const t = norm(raw);
  const m = t.match(/(\d{1,2})\s*(personas|persona|people|persons|person|guests|adults|adultos|personer|vuxna|personen|erwachsene|personnes|adultes|pax)\b/)
    ?? t.match(/\b(?:somos|we are|we're|vi ar|wir sind|nous sommes)\s+(\d{1,2})\b/);
  if (m) return +m[1];
  if (/\b(pareja|couple|par|paar|nous deux|los dos|two of us|vi tva|zu zweit)\b/.test(t)) return 2;
  return undefined;
}

const PET = /\b(perro|perra|perrito|gato|mascota|mascotas|dog|dogs|cat|pet|pets|hund|hundar|katt|husdjur|haustier|katze|chien|chat|animal)\b/;
const NO_PET = /\b(sin mascota|no pets|no pet|inga husdjur|kein haustier|pas d'animal|sin perro|no mascota)\b/;
const BOOK = /\b(reservar|reserva|book|booking|boka|bokning|buchen|buchung|reserver|reservation|disponible|disponibilidad|available|availability|ledig|frei|verfugbar|disponibilite)\b/;
const INFO = /\b(wifi|wi-fi|wlan|contrasena|password|losenord|passwort|mot de passe|check-in|checkin|check in|check-out|checkout|llegada|arrival|ankomst|ankunft|arrivee|llave|key|nyckel|schlussel|cle\b|codigo|code|kod\b|parking|aparcar|cajetin)/;
const INCIDENT = /(no funciona|no va |roto|rota|averia|fuga|gotera|no puedo entrar|no podemos entrar|no hay agua|no hay luz|sin luz|sin agua|ruido|sucio|sucia|doesn't work|does not work|not working|broken|leak|can't get in|cannot get in|locked out|no water|no power|noise|dirty|fungerar inte|trasig|lacker|kommer inte in|inget vatten|ingen strom|funktioniert nicht|kaputt|undicht|komme nicht rein|kein wasser|kein strom|ne marche pas|ne fonctionne pas|casse|fuite|je ne peux pas entrer|pas d'eau|pas d'electricite)/;
const URGENT = /(no puedo entrar|no podemos entrar|can't get in|cannot get in|locked out|kommer inte in|komme nicht rein|je ne peux pas entrer|fuga|leak|lacker|undicht|fuite|no hay luz|sin luz|no power|ingen strom|kein strom|pas d'electricite|gas|gaz|incendio|fire|brand|feuer|feu|humo|smoke)/;

function mentionedProperty(raw: string, catalog: Property[]): Property | undefined {
  const t = norm(raw);
  const byRef = raw.toUpperCase().match(/\b[A-Z]{2,3}-\d{2,3}\b/);
  if (byRef) return findProperty(catalog, byRef[0]);
  const generic = new Set(["estudio", "apartamento", "casa", "villa", "atico", "vacacional", "nerja", "playa", "sea", "view", "beautiful", "near", "beach", "perfect", "getaway"]);
  for (const p of catalog) {
    const words = norm(p.title).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !generic.has(w));
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(t))) return p;
  }
  return undefined;
}

export async function runMockVacationAgent(input: AgentInput): Promise<AgentOutput> {
  const { agency, lead, history, catalog } = input;
  const state = emptyTurnState();
  const text = [...history].reverse().find((m) => m.direction === "in")?.body ?? "";
  const t = norm(text);
  const lang = lead.inboundCount <= 1 ? detectLang(text, lead.language) : lead.language;
  if (lang !== lead.language) state.contactPatch.language = lang;
  const L = T[lang];
  const fill = (s: string) => s.replace("{a}", agency.assistantName).replace("{g}", agency.name);
  const parts: string[] = [];
  if (!history.some((m) => m.direction === "out")) parts.push(fill(L.greet));

  const confirmed = lead.guestPropertyId ? catalog.find((p) => p.id === lead.guestPropertyId) : undefined;
  const mentioned = mentionedProperty(text, catalog);
  const prop = mentioned ?? confirmed ?? findProperty(catalog, lead.profile.property_ref);
  if (mentioned) state.profilePatch.property_ref = mentioned.ref;

  // 1) Incidencias durante la estancia
  if (INCIDENT.test(t)) {
    const urgent = URGENT.test(t);
    state.incident = { propertyRef: prop?.ref, description: text.slice(0, 300), urgent };
    parts.push(urgent ? L.incident_urgent : L.incident);
    if (!prop) parts.push(L.which_property);
    return { reply: parts.join("\n"), state, engine: "demo" };
  }

  // 2) Huésped pide información práctica
  if (INFO.test(t)) {
    if (confirmed) {
      parts.push(L.your_info, confirmed.guestInfo || L.times);
    } else {
      parts.push(L.times, L.need_booking_name);
      state.handoff = {
        reason: "Huésped pide información privada (códigos/wifi)",
        summary: `Cliente${lead.name ? ` ${lead.name}` : ""} pide información de llegada${prop ? ` de ${prop.title}` : ""}. Confirmar su reserva y marcarlo como huésped en el panel para que la IA pueda darle códigos y wifi.`,
      };
    }
    return { reply: parts.join("\n"), state, engine: "demo" };
  }

  // 3) Busca alojamiento
  const dates = extractDates(text);
  const guests = extractGuests(text);
  Object.assign(state.profilePatch, dates);
  if (guests) state.profilePatch.guests = guests;
  if (NO_PET.test(t)) state.profilePatch.pets = false;
  else if (PET.test(t)) state.profilePatch.pets = true;
  const wantsBooking = BOOK.test(t) || /\b(si|sí|yes|ja|oui|vale|ok|dale|gerne|gärna|volontiers)\b/.test(t) && history.some((m) => m.direction === "out" && /\?$/.test(m.body.trim()) && /(confirm|bekräft|bestätig|confirme)/i.test(m.body));
  if (wantsBooking) state.profilePatch.wants_booking = true;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (email) state.contactPatch.email = email;
  const phone = text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
  if (phone) state.contactPatch.phone = phone.trim();

  const profile: LeadProfile = { ...lead.profile, ...state.profilePatch };

  if (profile.wants_booking && profile.check_in && profile.guests) {
    state.handoff = {
      reason: "Quiere reservar",
      summary: `Quiere reservar${prop ? ` ${prop.title}` : ""}: del ${profile.check_in} al ${profile.check_out ?? "?"}, ${profile.guests} personas${profile.pets ? ", con mascota" : ""}. Confirmar disponibilidad y precio.`,
    };
    if (prop?.bookingUrl) parts.push(`${prop.title}: ${prop.bookingUrl}`);
    parts.push(L.handoff);
    return { reply: parts.join("\n"), state, engine: "demo" };
  }

  const learned = dates.check_in || guests || state.profilePatch.pets !== undefined || mentioned;
  if (learned && (profile.guests || mentioned)) {
    const found = mentioned ? [mentioned] : searchCatalog(catalog, { guests: profile.guests, pets: profile.pets }).slice(0, 3);
    if (found.length) {
      parts.push(L.options);
      for (const p of found) {
        parts.push(`• ${p.title} (${p.maxGuests} pers., ${p.areaM2} m²${p.features.length ? `, ${p.features.slice(0, 2).join(", ")}` : ""})${p.bookingUrl ? `\n  ${p.bookingUrl}` : ""}`);
        state.shownRefs.push(p.ref);
      }
      parts.push(L.link);
    } else {
      parts.push(L.none);
    }
  }

  const next: Key = !profile.check_in ? "ask_dates" : !profile.guests ? "ask_guests" : profile.pets === undefined ? "ask_pets" : "offer_team";
  parts.push(L[next]);
  return { reply: parts.join("\n"), state, engine: "demo" };
}
