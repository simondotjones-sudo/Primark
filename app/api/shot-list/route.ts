import { getAdminUser } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from "next/server";
import { db, now } from "@/lib/server";
import { getShot } from "@/lib/shot-list";
import { sameOrigin, shotData, shotFail } from "@/lib/shot-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    if (!await getAdminUser()) return shotFail("Platform admin sign-in is required.", 403);
    return NextResponse.json(await shotData(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Shot list load failed", error);
    return shotFail("The shot list could not be loaded. Please try again.", 503);
  }
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return shotFail("Please save from the shot-list page.", 403);
    const admin = await getAdminUser();
    if (!admin) return shotFail("Platform admin sign-in is required.", 403);
    const raw = await request.text();
    if (raw.length > 4000) return shotFail("This note is too long.", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return shotFail("Invalid slide update."); }
    const module = Number(body.module), slide = Number(body.slide);
    if (!getShot(module, slide)) return shotFail("Unknown module or slide.");
    const status = body.status;
    if (status !== "todo" && status !== "complete" && status !== "unavailable") return shotFail("Choose a valid slide status.");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 500) return shotFail("Keep the note to 500 characters.");
    if (status === "unavailable" && !note) return shotFail("Add a short note explaining what is unavailable.");
    if (status === "complete") {
      const photo = await db().prepare("SELECT id FROM shot_photos WHERE module_number=? AND slide_number=? LIMIT 1").bind(module, slide).first();
      if (!photo) return shotFail("Save at least one photo before marking this slide complete.");
    }
    const date = now();
    await db().prepare(`INSERT INTO shot_states(module_number,slide_number,status,note,updated_by_admin,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(module_number,slide_number) DO UPDATE SET status=excluded.status,note=excluded.note,updated_by=NULL,updated_by_admin=excluded.updated_by_admin,updated_at=excluded.updated_at`)
      .bind(module,slide,status,note,admin.email,date).run();
    return NextResponse.json({ state: { module_number: module, slide_number: slide, status, note, updated_at: date } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Shot status save failed", error);
    return shotFail("The slide status was not saved. Please try again.", 503);
  }
}
