import { CHUNK_SIZE, readChunk } from '@/lib/storage';
import { NextRequest } from 'next/server';
import { db } from '@/lib/server';
import { photoBucket } from '@/lib/shot-server';
import { failed, getPackage, json, requireAdmin, CourseError } from '@/lib/course-admin';
export const dynamic='force-dynamic';
export async function PUT(request:NextRequest,context:{params:Promise<{id:string}>}) {try {
  await requireAdmin(request); const {id}=await context.params; const path=request.nextUrl.searchParams.get('path')||'';
  const pack=await getPackage(id); if(!pack||pack.status!=='uploading') throw new CourseError('This upload is closed.',409);
  const file=await db().prepare('SELECT size,uploaded FROM course_files WHERE package_id=? AND path=?').bind(id,path).first<{size:number;uploaded:number}>();
  if(!file) throw new CourseError('File is not in the upload manifest.');
  if(file.uploaded) return json({ok:true});
  const offset=Number(request.nextUrl.searchParams.get('offset')||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset%CHUNK_SIZE||offset>file.size||(file.size>0&&offset===file.size))throw new CourseError('Invalid file part.');
  const bytes=await readChunk(request);
  if(bytes.byteLength!==Math.min(CHUNK_SIZE,file.size-offset))throw new CourseError('The file part size does not match.');
  const key=`scorm/${id}/${path}`,bucket=photoBucket();
  await bucket.writeChunk(key,offset/CHUNK_SIZE,bytes);
  if(offset+bytes.byteLength<file.size)return json({ok:true,complete:false});
  await bucket.complete(key,file.size);
  await db().prepare('UPDATE course_files SET uploaded=1 WHERE package_id=? AND path=?').bind(id,path).run();
  return json({ok:true});
}catch(e){return failed(e);} }
