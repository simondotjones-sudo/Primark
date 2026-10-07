import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json,requireAdmin} from '@/lib/course-admin';
import {getAdminUser} from '@/lib/admin-auth';
import {db,now} from '@/lib/server';
import {storeDirectory} from '@/lib/store-directory';
export const dynamic='force-dynamic';
export async function GET(){try{await requireAdmin();return json({stores:await storeDirectory()});}catch(error){return failed(error);}}
export async function POST(request:NextRequest){try{
  await requireAdmin(request);
  const body=await bodyJson(request,10000),admin=await getAdminUser();
  const stores=await storeDirectory();
  const existing=body.action==='add'?undefined:stores.find(s=>s.id===body.id);
  if(!['add','archive','restore'].includes(body.action))throw new CourseError('Invalid request.');
  if(body.action!=='add'&&!existing)throw new CourseError('Choose a store.');
  const name=body.action==='add'&&typeof body.name==='string'?body.name.trim():existing?.name||'';
  const country=body.action==='add'&&typeof body.country==='string'?body.country.trim():existing?.country||'';
  if(!name||name.length>150||!country||country.length>80)throw new CourseError('Check the store name and country.');
  if(body.action==='add'&&stores.some(s=>s.country.toLowerCase()===country.toLowerCase()&&s.name.toLowerCase()===name.toLowerCase()))throw new CourseError('This store already exists.');
  const id=existing?.id||crypto.randomUUID(),active=body.action!=='archive',date=now();
  await db().batch([
    db().prepare('INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(id,name,country,active,admin!.email,date),
    db().prepare('INSERT INTO organisation_store_audit(id,store_id,actor,action,recorded_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,admin!.email,body.action,date),
  ]);
  return json({stores:await storeDirectory()});
}catch(error){return failed(error);}}
