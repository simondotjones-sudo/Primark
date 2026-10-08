import { learnerOnlySql } from "@/lib/account-type";
import { issuePassportCertificate } from "@/lib/certificate-server";
import { db } from "@/lib/database";
export { db } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";
import stores from "@/lib/stores.json";
import { isSecureRequest } from '@/lib/request-origin';

export type Learner = {
  id: string; name: string; email: string; store_id: string; country: string;
  entered_at: string; started_at: string | null; completed_at: string | null;
  best_score: number | null; certificate_token: string | null;
  induction_enrolled: boolean; admin_only: boolean;
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
    SELECT l.id,l.name,l.email,l.store_id,l.country,l.entered_at,l.started_at,l.completed_at,l.best_score,l.certificate_token,l.induction_enrolled,NOT (${learnerOnlySql()}) AS admin_only
    FROM sessions s JOIN learners l ON l.id=s.learner_id
    WHERE s.token_hash=? AND s.expires_at>? AND l.archived_at IS NULL
  `).bind(await hash(token), now()).first<Learner>()) ?? null;
}
export async function withSession(request: NextRequest, learnerId: string, data: unknown) {
  const token = randomToken();
  const expiry = new Date(Date.now() + 30 * 86400000);
  const statements = [db().prepare("INSERT INTO sessions(token_hash,learner_id,expires_at) SELECT ?,id,? FROM learners WHERE id=? AND archived_at IS NULL")
    .bind(await hash(token), expiry.toISOString(), learnerId)];
  const adminToken = request.cookies.get('primark_admin')?.value;
  const previousToken = request.cookies.get('primark_session')?.value;
  if (adminToken) statements.push(db().prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(adminToken)));
  if (previousToken) statements.push(db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(previousToken)));
  const saved=await db().batch(statements);
  if(!saved[0].meta.changes)return NextResponse.json({error:'Those details did not match.'},{status:401});
  const response = NextResponse.json(data);
  response.cookies.set("primark_session", token, {
    httpOnly: true, secure: isSecureRequest(request), sameSite: "lax",
    path: "/", expires: expiry,
  });
  response.cookies.delete('primark_admin');
  response.headers.set('Cache-Control', 'private, no-store');
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
    await db().batch([db().prepare("UPDATE learners SET completed_at=?,certificate_token=? WHERE id=? AND completed_at IS NULL")
      .bind(date, token, learner.id),issuePassportCertificate(learner.id)]);
  }
}
