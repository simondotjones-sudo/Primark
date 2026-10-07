import { getAdminUser } from '@/lib/admin-auth';
import { NextRequest } from "next/server";
import { db } from "@/lib/server";
import { getShot } from "@/lib/shot-list";
import { photoBucket, shotFail } from "@/lib/shot-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await getAdminUser()) return shotFail("Platform admin sign-in is required.", 403);
    const { id } = await params;
    const photo = await db().prepare("SELECT object_key,thumbnail_key,filename,mime_type,module_number,slide_number FROM shot_photos WHERE id=?").bind(id)
      .first<{object_key:string;thumbnail_key:string|null;filename:string;mime_type:string;module_number:number;slide_number:number}>();
    if (!photo) return shotFail("This photo was not found.", 404);
    const preview = request.nextUrl.searchParams.get("preview") === "1" && !!photo.thumbnail_key;
    const download = request.nextUrl.searchParams.get("download") === "1";
    const title = getShot(photo.module_number,photo.slide_number)?.title.replace(/[^a-zA-Z0-9]+/g,"-") || "Photo";
    const ext = ({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic"} as Record<string,string>)[photo.mime_type] || "jpg";
    const filename = `M${String(photo.module_number).padStart(2,"0")}_S${String(photo.slide_number).padStart(2,"0")}_${title}_${id.slice(0,8)}.${ext}`;
    const headers = {
      "Content-Type": preview ? "image/jpeg" : photo.mime_type,
      "Content-Disposition": `${download || (!preview && photo.mime_type === "image/heic") ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    const key=preview ? photo.thumbnail_key! : photo.object_key;
    if(request.headers.get("x-primark-storage-descriptor")==="1")return Response.json({key,headers},{headers:{"Cache-Control":"private, no-store"}});
    const object=await photoBucket().get(key);
    if(!object)return shotFail("This photo is temporarily unavailable.",503);
    return new Response(object.body,{headers:{...headers,"Content-Length":String(object.size)}});
  } catch (error) {
    console.error("Shot photo read failed", error);
    return shotFail("The photo could not be loaded. Please try again.", 503);
  }
}
