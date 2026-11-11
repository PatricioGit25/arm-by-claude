/**
 * WhatsApp Business (Meta Cloud API).
 * Nota: fuera de la ventana de 24 h desde el último mensaje del cliente, Meta
 * solo permite enviar plantillas aprobadas. Los seguimientos automáticos de días
 * posteriores necesitan una plantilla (ver README).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappEnabled(phoneNumberId?: string | null): boolean {
  return !!(process.env.WHATSAPP_TOKEN && phoneNumberId);
}

export async function sendWhatsAppText(phoneNumberId: string, to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/[^\d]/g, ""),
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
}

/** Extrae los mensajes de texto entrantes de un webhook de Meta. */
export function parseWhatsAppWebhook(payload: unknown): {
  phoneNumberId: string;
  from: string;
  name?: string;
  text: string;
}[] {
  const out: { phoneNumberId: string; from: string; name?: string; text: string }[] = [];
  const p = payload as {
    entry?: { changes?: { value?: {
      metadata?: { phone_number_id?: string };
      contacts?: { wa_id?: string; profile?: { name?: string } }[];
      messages?: { from?: string; type?: string; text?: { body?: string } }[];
    } }[] }[];
  };
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of v?.messages ?? []) {
        if (m.type !== "text" || !m.from || !m.text?.body) continue;
        const name = v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        out.push({ phoneNumberId, from: m.from, name, text: m.text.body });
      }
    }
  }
  return out;
}
