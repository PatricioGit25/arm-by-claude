import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { leads, messages } from "@/lib/db/schema";
import { getAgencyBySlug, handleInbound } from "@/lib/engine";

export const dynamic = "force-dynamic";

const VISITOR = /^[a-zA-Z0-9-]{8,64}$/;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const visitor = new URL(req.url).searchParams.get("visitor") ?? "";
  const agency = await getAgencyBySlug(slug);
  if (!agency || !VISITOR.test(visitor)) return NextResponse.json({ messages: [] });
  const db = await getDb();
  const lead = (await db.select().from(leads).where(and(eq(leads.agencyId, agency.id), eq(leads.channel, "web"), eq(leads.externalId, visitor))))[0];
  if (!lead) return NextResponse.json({ messages: [] });
  const msgs = await db.select({ id: messages.id, direction: messages.direction, author: messages.author, body: messages.body, createdAt: messages.createdAt })
    .from(messages).where(eq(messages.leadId, lead.id)).orderBy(asc(messages.createdAt));
  return NextResponse.json({ messages: msgs });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agency = await getAgencyBySlug(slug);
  if (!agency) return NextResponse.json({ error: "Inmobiliaria no encontrada" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { visitor?: string; text?: string };
  const text = (body.text ?? "").trim().slice(0, 2000);
  if (!body.visitor || !VISITOR.test(body.visitor) || !text) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { reply, lead, engine } = await handleInbound({ agency, channel: "web", externalId: body.visitor, text, source: "Web" });
  return NextResponse.json({ reply, stage: lead.stage, score: lead.score, engine });
}
