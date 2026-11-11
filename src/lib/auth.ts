import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { agencies, users, type Agency, type User } from "./db/schema";

const COOKIE = "arm_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("Falta AUTH_SECRET");
  return s || "dev-secret-no-usar-en-produccion";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export async function createSession(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${userId}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE, path: "/",
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<{ user: User; agency: Agency } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [userId, exp, sig] = raw.split(".");
  if (!userId || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const db = await getDb();
  const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!user) return null;
  const agency = (await db.select().from(agencies).where(eq(agencies.id, user.agencyId)))[0];
  return agency ? { user, agency } : null;
}

export async function requireUser() {
  const s = await currentUser();
  if (!s) redirect("/login");
  return s;
}
