import { db } from "@/lib/database";
export { db } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";
import stores from "@/lib/stores.json";

export type Learner = {
  id: string; name: string; email: string; store_id: string; country: string;
  entered_at: string; started_at: string | null; completed_at: string | null;
  best_score: number | null; certificate_token: string | null;
};


export const storeById = new Map(stores.map((store) => [store.id, store]));
export function now() { return new Date().toISOString(); }
export function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "PR-" + [...bytes].map((n) => alphabet[n % alphabet.length]).join("");
}
export function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function currentLearner(request: NextRequest): Promise<Learner | null> {
  const token = request.cookies.get("primark_session")?.value;
  return learnerForSession(token);
}
export async function learnerForSession(token: string | undefined): Promise<Learner | null> {
  if (!token) return null;
  return (await db().prepare(`
    SELECT l.id,l.name,l.email,l.store_id,l.country,l.entered_at,l.started_at,l.completed_at,l.best_score,l.certificate_token
    FROM sessions s JOIN learners l ON l.id=s.learner_id
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(await hash(token), now()).first<Learner>()) ?? null;
}
export async function withSession(request: NextRequest, learnerId: string, data: unknown) {
  const token = randomToken();
  const expiry = new Date(Date.now() + 30 * 86400000);
  await db().prepare("INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)")
    .bind(await hash(token), learnerId, expiry.toISOString()).run();
  const response = NextResponse.json(data);
  response.cookies.set("primark_session", token, {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax",
    path: "/", expires: expiry,
  });
  return response;
}
export async function progressFor(learnerId: string) {
  const rows = await db().prepare("SELECT module_key FROM module_views WHERE learner_id=?").bind(learnerId).all<{ module_key: string }>();
  return rows.results.map((r) => r.module_key);
}
export async function completeIfReady(learner: Learner, viewed: string[]) {
  if (!learner.completed_at && (learner.best_score ?? 0) >= 18 && viewed.length >= 6) {
    const date = now();
    const token = randomToken();
    await db().prepare("UPDATE learners SET completed_at=?,certificate_token=? WHERE id=? AND completed_at IS NULL")
      .bind(date, token, learner.id).run();
  }
}
