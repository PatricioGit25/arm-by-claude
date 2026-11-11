import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agencies } from "@/lib/db/schema";
import { ingestPortalEmail } from "@/lib/intake";

export const dynamic = "force-dynamic";

/**
 * Buzón de emails de portales (Idealista, Fotocasa, Rightmove...). Recibe el
 * email reenviado por un servicio de correo entrante (Postmark, CloudMailin,
 * Mailgun, SendGrid, Make, Zapier...) en JSON o formulario.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const agency = (await db.select().from(agencies).where(eq(agencies.inboundToken, token)))[0];
  if (!agency) return NextResponse.json({ error: "Buzón no encontrado" }, { status: 404 });

  const type = req.headers.get("content-type") ?? "";
  let b: Record<string, unknown> = {};
  try {
    if (type.includes("json")) b = (await req.json()) as Record<string, unknown>;
    else b = Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ error: "Formato no válido" }, { status: 400 });
  }
  const headers = (b.headers ?? {}) as Record<string, unknown>;
  const envelope = (b.envelope ?? {}) as Record<string, unknown>;
  const str = (...v: unknown[]) => v.find((x) => typeof x === "string" && x.trim()) as string | undefined;
  const html = str(b.HtmlBody, b.html, b["body-html"]);
  const text = str(b.TextBody, b.text, b["body-plain"], b.plain, b["stripped-text"], b.body) ?? (html ? htmlToText(html) : "");
  if (!text) return NextResponse.json({ error: "Email sin texto" }, { status: 400 });

  const result = await ingestPortalEmail(agency, {
    from: str(b.From, b.from, b.sender, envelope.from, headers.from, headers.From),
    subject: str(b.Subject, b.subject, headers.subject, headers.Subject),
    messageId: str(b.messageId, b.MessageID, b["Message-Id"], headers["message-id"], headers["Message-ID"]),
    text,
  });
  return NextResponse.json(result.ok ? { ok: true, leadId: result.lead.id } : { ok: false, error: result.error });
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
