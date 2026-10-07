import { getAdminUser } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { db, now, hash } from '@/lib/server';
import { getShot } from '@/lib/shot-list';
import { CHUNK_SIZE } from '@/lib/storage';
import { getPhoto, imageType, MAX_PHOTO_BYTES, photoBucket, readPhotoForm, sameOrigin, shotFail } from '@/lib/shot-server';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {try {
  if(!sameOrigin(request))return shotFail('Please upload from the shot-list page.',403);
  const admin=await getAdminUser();if(!admin)return shotFail('Platform admin sign-in is required.',403);
  const actor='admin-'+(await hash(admin.email)).slice(0,24);
  if(Number(request.headers.get('content-length'))>CHUNK_SIZE+600000)return shotFail('Upload this photo in smaller parts.',413);
  const form=await readPhotoForm(request);
  const module=Number(form.get('module')),slide=Number(form.get('slide')),id=String(form.get('id')||'');
  const total=Number(form.get('total')),offset=Number(form.get('offset'));
  if(!getShot(module,slide))return shotFail('Unknown module or slide.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return shotFail('Invalid photo reference.');
  if(!Number.isSafeInteger(total)||total<=0||total>MAX_PHOTO_BYTES||!Number.isSafeInteger(offset)||offset<0||offset>=total||offset%CHUNK_SIZE)return shotFail('Invalid photo part.');
  const existing=await getPhoto(id);
  if(existing){if(existing.uploaded_by_admin!==admin.email||existing.module_number!==module||existing.slide_number!==slide)return shotFail('This photo reference is already in use.',409);return NextResponse.json({photo:existing});}
  const file=form.get('photo'),thumbnail=form.get('thumbnail');
  if(!(file instanceof File)||file.size!==Math.min(CHUNK_SIZE,total-offset))return shotFail('The photo part is incomplete.');
  if(thumbnail instanceof File&&(thumbnail.size>512*1024||(await imageType(thumbnail))?.mime!=='image/jpeg'))return shotFail('The photo preview was not valid.');
  const bucket=photoBucket(),key=`shot-list/m${module}/s${slide}/${actor}/${id}`;
  await bucket.writeChunk(key,offset/CHUNK_SIZE,await file.arrayBuffer());
  if(offset+file.size<total)return NextResponse.json({ok:true,complete:false});
  await bucket.complete(key,total);
  const first=await bucket.get(key,{range:new Headers({range:`bytes=0-${Math.min(63,total-1)}`})});
  const type=first?await imageType(new File([await first.arrayBuffer()],'photo')):null;
  if(!type)return shotFail('Use a JPEG, PNG, WebP or HEIC photo.');
  const thumbnailKey=thumbnail instanceof File?`shot-list/previews/${actor}/${id}.jpg`:null;
  if(thumbnail instanceof File&&thumbnailKey)await bucket.put(thumbnailKey,await thumbnail.arrayBuffer());
  const name=String(form.get('name')||'photo').replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,180);
  await db().prepare('INSERT INTO shot_photos(id,module_number,slide_number,filename,mime_type,size,object_key,thumbnail_key,uploaded_by_admin,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(id,module,slide,name,type.mime,total,key,thumbnailKey,admin.email,now()).run();
  return NextResponse.json({photo:await getPhoto(id)},{status:201,headers:{'Cache-Control':'private, no-store'}});
}catch(error){console.error('Photo upload failed',error);return shotFail('The photo could not be confirmed as saved. Keep this page open and retry.',503);} }
