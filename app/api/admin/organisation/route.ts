import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {credentials} from '@/lib/admin-auth';
import {now,hash,randomToken} from '@/lib/server';
import {inTransaction} from '@/lib/database';
import {hashPassword,validPassword} from '@/lib/learner-auth';
import {storeDirectory} from '@/lib/store-directory';
import {requireStoreAdministrator,requireStoreScope} from '@/lib/organisation-administration';
import type {UserAdministrator} from '@/lib/user-administration';
export const dynamic='force-dynamic';
const visible=(actor:UserAdministrator,stores:Awaited<ReturnType<typeof storeDirectory>>)=>stores.filter(s=>actor.platformAdmin||actor.access.scope==='organisation'||s.country===actor.access.country);
export async function GET(){try{const actor=await requireStoreAdministrator();return json({stores:visible(actor,await storeDirectory(true,true)),access:actor.access,canAddCountry:actor.platformAdmin||actor.access.scope==='organisation'});}catch(error){return failed(error);}}
export async function POST(request:NextRequest){try{
  const original=await requireStoreAdministrator(request),body=await bodyJson(request,10000);
  if(!body||typeof body!=='object'||Array.isArray(body)||!['add','archive','restore'].includes(body.action))throw new CourseError('Invalid request.');
  const stores=await storeDirectory(true,true);
  const existing=body.action==='add'?undefined:stores.find(s=>s.id===body.id);
  if(body.action!=='add'&&!existing)throw new CourseError('Choose a store.');
  const name=body.action==='add'&&typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):existing?.name||'';
  const inputCountry=body.action==='add'&&typeof body.country==='string'?body.country.trim().replace(/\s+/g,' '):existing?.country||'';
  const knownCountry=stores.find(s=>s.country.toLowerCase()===inputCountry.toLowerCase())?.country;
  const country=knownCountry||inputCountry;
  if(!name||name.length>150||!country||country.length>80)throw new CourseError('Check the store name and country.');
  if(body.action==='add'&&!knownCountry&&body.newCountry!==true)throw new CourseError('Choose a country or select Add new country.');
  if(body.action==='add'&&stores.some(s=>s.country===country&&s.name.toLowerCase()===name.toLowerCase()))throw new CourseError('This store already exists.');
  const code=body.action==='add'&&typeof body.storeCode==='string'?body.storeCode.trim().toUpperCase():null;
  if(code&&!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(code))throw new CourseError('Use up to 50 letters, numbers, dots, hyphens or underscores for the store code.');
  const email=body.action==='add'&&typeof body.adminEmail==='string'?body.adminEmail.trim().toLowerCase():'';
  if(email&&(email.length>254||/[<>,;:"\\]/.test(email)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new CourseError('Enter a valid email address.');
  if(email===credentials()?.email)throw new CourseError('This email already has an account. Assign it through Manage Users.',409);
  const initialPassword=typeof body.adminPassword==='string'?body.adminPassword:'';
  if(email&&initialPassword&&(!validPassword(initialPassword)||initialPassword.length<16))throw new CourseError('Admin passwords need 16–128 characters.');
  const passwordHash=email?await hashPassword(initialPassword||randomToken()+randomToken()):null;
  const id=existing?.id||crypto.randomUUID(),adminId=email?crypto.randomUUID():null,date=now();
  let acting=original;
  await inTransaction(async client=>{
    let actor=original;
    if(actor.id){
      const current=(await client.query(`SELECT l.email,l.archived_at,r.scope,r.country,r.site_id,
        EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) AS platform_admin
        FROM learners l LEFT JOIN reporting_access r ON r.learner_id=l.id WHERE l.id=$1 FOR UPDATE OF l`,[actor.id])).rows[0];
      if(!current||current.archived_at)throw new CourseError('Organisation or country admin access is required.',403);
      actor={...actor,email:String(current.email),platformAdmin:!!current.platform_admin,access:{scope:current.scope as UserAdministrator['access']['scope'],country:current.country as string|null,siteId:current.site_id as string|null}};
      requireStoreScope(actor);
    }
    if(!actor.platformAdmin&&actor.access.scope==='country'&&country!==actor.access.country)throw new CourseError('You can manage stores only within your assigned country.',403);
    acting=actor;
    if(email){
      if((await client.query('SELECT id FROM learners WHERE email=$1',[email])).rows.length)throw new CourseError('This email already has an account. Assign it through Manage Users.',409);
      await client.query('INSERT INTO learners(id,name,email,password_hash,code_hash,store_id,country,entered_at,induction_enrolled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false)',[adminId,(name+' admin').slice(0,101),email,passwordHash,await hash(randomToken()),id,country,date]);
      await client.query("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES($1,'site',$2,$3,$4,$5)",[adminId,country,id,actor.email,date]);
      await client.query('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES($1,$2,$3,$4)',[adminId,id,actor.email,date]);
    }
    await client.query('INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at,store_code,admin_learner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[id,name,country,body.action!=='archive',actor.email,date,code||null,adminId]);
    await client.query('INSERT INTO organisation_store_audit(id,store_id,actor,action,recorded_at) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),id,actor.email,body.action,date]);
  });
  return json({stores:visible(acting,await storeDirectory(true,true)),adminCreated:!!email,passwordSetupPending:!!email&&!initialPassword});
}catch(error){if((error as {code?:string}).code==='23505')return failed(new CourseError((error as {constraint?:string}).constraint?.includes('code')?'This store code is already in use.':(error as {constraint?:string}).constraint?.includes('email')?'This email already has an account. Assign it through Manage Users.':'This store already exists.',409));return failed(error);}}
