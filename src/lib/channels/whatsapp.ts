/**
 * WhatsApp Business (Meta Cloud API).
 * Nota: fuera de la ventana de 24 h desde el último mensaje del cliente, Meta
 * solo permite enviar plantillas aprobadas. Los seguimientos automáticos de días
 * posteriores necesitan una plantilla (ver README).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const auth = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

export function whatsappEnabled(phoneNumberId?: string | null): boolean {
  return !!(process.env.WHATSAPP_TOKEN && phoneNumberId);
}

/**
 * Comprueba que el webhook viene de Meta (cabecera X-Hub-Signature-256 firmada
 * con la clave secreta de la app). Sin WHATSAPP_APP_SECRET no se comprueba.
 */
export function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function sendWhatsAppText(phoneNumberId: string, to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "text", text: { body, preview_url: true } }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
}

/** Marca el mensaje como leído (doble check azul). */
export async function markWhatsAppRead(phoneNumberId: string, messageId: string): Promise<void> {
  await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}

/** Descarga un archivo (audio, imagen…) que el cliente envió. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<Blob> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: auth() });
  if (!meta.ok) throw new Error(`WhatsApp media ${meta.status}: ${await meta.text()}`);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type?: string };
  const file = await fetch(url, { headers: auth() });
  if (!file.ok) throw new Error(`WhatsApp media ${file.status}`);
  return new Blob([await file.arrayBuffer()], { type: mime_type ?? "application/octet-stream" });
}

export interface WhatsAppInbound {
  id: string;
  phoneNumberId: string;
  from: string;
  name?: string;
  kind: "text" | "audio" | "other";
  text: string; // texto, o descripción de lo que mandó
  mediaId?: string;
}

/** Extrae los mensajes entrantes de un webhook de Meta (ignora estados de entrega). */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInbound[] {
  const out: WhatsAppInbound[] = [];
  type Msg = {
    id?: string; from?: string; type?: string;
    text?: { body?: string };
    button?: { text?: string };
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
    audio?: { id?: string };
    image?: { caption?: string };
    video?: { caption?: string };
    document?: { caption?: string; filename?: string };
    location?: { name?: string; address?: string; latitude?: number; longitude?: number };
    reaction?: { emoji?: string };
  };
  const p = payload as {
    entry?: { changes?: { value?: {
      metadata?: { phone_number_id?: string };
      contacts?: { wa_id?: string; profile?: { name?: string } }[];
      messages?: Msg[];
    } }[] }[];
  };
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of v?.messages ?? []) {
        if (!m.from || !m.id) continue;
        const name = v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const base = { id: m.id, phoneNumberId, from: m.from, name };
        const caption = (c?: string) => (c ? `: ${c}` : "");
        switch (m.type) {
          case "text": if (m.text?.body) out.push({ ...base, kind: "text", text: m.text.body }); break;
          case "button": if (m.button?.text) out.push({ ...base, kind: "text", text: m.button.text }); break;
          case "interactive": {
            const t = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
            if (t) out.push({ ...base, kind: "text", text: t });
            break;
          }
          case "audio": out.push({ ...base, kind: "audio", text: "[Nota de voz]", mediaId: m.audio?.id }); break;
          case "image": out.push({ ...base, kind: "other", text: `[Foto${caption(m.image?.caption)}]` }); break;
          case "video": out.push({ ...base, kind: "other", text: `[Vídeo${caption(m.video?.caption)}]` }); break;
          case "document": out.push({ ...base, kind: "other", text: `[Documento ${m.document?.filename ?? ""}${caption(m.document?.caption)}]` }); break;
          case "location": out.push({ ...base, kind: "other", text: `[Ubicación: ${m.location?.name ?? m.location?.address ?? `${m.location?.latitude},${m.location?.longitude}`}]` }); break;
          case "reaction": break; // un 👍 a un mensaje no necesita respuesta
          default: out.push({ ...base, kind: "other", text: `[Mensaje de tipo ${m.type}]` });
        }
      }
    }
  }
  return out;
}

/** Envía un audio (MP3) por WhatsApp: primero se sube a Meta y luego se manda. */
export async function sendWhatsAppAudio(phoneNumberId: string, to: string, mp3: ArrayBuffer): Promise<void> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "audio/mpeg");
  form.append("file", new Blob([mp3], { type: "audio/mpeg" }), "resumen.mp3");
  const up = await fetch(`${GRAPH}/${phoneNumberId}/media`, { method: "POST", headers: auth(), body: form });
  if (!up.ok) throw new Error(`WhatsApp media ${up.status}: ${await up.text()}`);
  const { id } = (await up.json()) as { id: string };
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "audio", audio: { id } }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
}
