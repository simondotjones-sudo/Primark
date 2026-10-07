export { photoBucket } from "@/lib/storage";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server";
import type { ShotPhoto, ShotState } from "@/lib/shot-list";

export const shotFail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
export const photoColumns = "p.id,p.module_number,p.slide_number,p.filename,p.mime_type,p.size,CASE WHEN p.thumbnail_key IS NOT NULL THEN 1 ELSE 0 END AS has_thumbnail,p.uploaded_at,p.uploaded_by,l.name AS uploader_name";
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === request.nextUrl.origin);
}
export async function shotData() {
  const [photos, states] = await Promise.all([
    db().prepare(`SELECT ${photoColumns} FROM shot_photos p JOIN learners l ON l.id=p.uploaded_by ORDER BY p.uploaded_at DESC`).all<ShotPhoto>(),
    db().prepare("SELECT module_number,slide_number,status,note,updated_at FROM shot_states").all<ShotState>(),
  ]);
  return { photos: photos.results, states: states.results };
}
export async function getPhoto(id: string) {
  return db().prepare(`SELECT ${photoColumns} FROM shot_photos p JOIN learners l ON l.id=p.uploaded_by WHERE p.id=?`).bind(id).first<ShotPhoto>();
}
export async function imageType(file: File): Promise<{mime: string; ext: string} | null> {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: "image/jpeg", ext: "jpg" };
  if ([137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return { mime: "image/png", ext: "png" };
  const text = new TextDecoder().decode(b);
  if (text.slice(0,4) === "RIFF" && text.slice(8,12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (text.slice(4,8) === "ftyp" && /heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8))) return { mime: "image/heic", ext: "heic" };
  return null;
}
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export class PhotoTooLarge extends Error {}
export async function readPhotoForm(request: NextRequest): Promise<FormData> {
  if (!request.body) throw new Error("Missing photo body.");
  const reader = request.body.getReader();
  let received = 0;
  const limited = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) { controller.close(); return; }
      received += next.value.byteLength;
      if (received > MAX_PHOTO_BYTES + 1024 * 1024) {
        controller.error(new PhotoTooLarge("Photo upload exceeds the size limit."));
        await reader.cancel(); return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(limited, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
}
