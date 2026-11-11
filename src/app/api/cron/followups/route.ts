import { NextResponse } from "next/server";
import { runFollowups } from "@/lib/engine";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Llamar cada hora (Vercel Cron, GitHub Actions, cron-job.org...). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runFollowups());
}
