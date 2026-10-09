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
  if(!body||typeof body!=='object'||Array.isArray(body)||!['add','edit','archive','restore','delete'].includes(body.action))throw new CourseError('Invalid request.');
  const stores=await storeDirectory(true,true);
  const existing=body.action==='add'?undefined:stores.find(s=>s.id===body.id);
  if(body.action!=='add'&&!existing)throw new CourseError('Choose a store.');
  const details=body.action==='add'||body.action==='edit';
  let name=details&&typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):existing?.name||'';
  const inputCountry=details&&typeof body.country==='string'?body.country.trim().replace(/\s+/g,' '):existing?.country||'';
  const knownCountry=stores.find(s=>s.country.toLowerCase()===inputCountry.toLowerCase())?.country;
  let country=knownCountry||inputCountry;
  if(!name||name.length>150||!country||country.length>80)throw new CourseError('Check the store name and country.');
  if(details&&!knownCountry&&body.newCountry!==true)throw new CourseError('Choose a country or select Add new country.');
  if(body.action==='add'&&stores.some(s=>s.country===country&&s.name.toLowerCase()===name.toLowerCase()))throw new CourseError('This store already exists.');
  let code=details&&typeof body.storeCode==='string'?body.storeCode.trim().toUpperCase():existing?.storeCode||null;
  if(code&&!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(code))throw new CourseError('Use up to 50 letters, numbers, dots, hyphens or underscores for the store code.');
  const email=details&&typeof body.adminEmail==='string'?body.adminEmail.trim().toLowerCase():'';
  if(email&&(email.length>254||/[<>,;:"\\]/.test(email)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new CourseError('Enter a valid email address.');
  if(body.action==='add'&&email===credentials()?.email)throw new CourseError('This email already has an account. Assign it through Manage Users.',409);
  const initialPassword=typeof body.adminPassword==='string'?body.adminPassword:'';
  if(body.action==='add'&&email&&initialPassword&&(!validPassword(initialPassword)||initialPassword.length<16))throw new CourseError('Admin passwords need 16–128 characters.');
  const passwordHash=body.action==='add'&&email?await hashPassword(initialPassword||randomToken()+randomToken()):null;
  const id=existing?.id||crypto.randomUUID(),adminId=body.action==='add'&&email?crypto.randomUUID():null,date=now();
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
    const current=existing?(await client.query('SELECT country,name,active,store_code,updated_at,deleted_at FROM organisation_stores WHERE id=$1 FOR UPDATE',[id])).rows[0]:undefined;
    const currentCountry=String(current?.country||existing?.country||country);
    if(!actor.platformAdmin&&actor.access.scope==='country'&&(country!==actor.access.country||currentCountry!==actor.access.country))throw new CourseError('You can manage stores only within your assigned country.',403);
    acting=actor;
    if(current?.deleted_at)throw new CourseError('Choose a store.',409);
    if(body.action==='delete'){
      if(!current||!(await client.query('SELECT store_can_delete($1) AS allowed',[id])).rows[0]?.allowed)throw new CourseError('Only archived stores with no linked accounts or records can be deleted.',409);
      await client.query('UPDATE organisation_stores SET deleted_at=$2,deleted_by=$3,updated_at=$2,updated_by=$3 WHERE id=$1',[id,date,actor.email]);
      await client.query('UPDATE store_credit_accounts SET active=false WHERE store_id=$1',[id]);
      await client.query("INSERT INTO organisation_store_audit(id,store_id,actor,action,recorded_at) VALUES($1,$2,$3,'delete',$4)",[crypto.randomUUID(),id,actor.email,date]);
      return;
    }
    if(body.action==='edit'&&(body.revision??null)!==(current?.updated_at??null))throw new CourseError('This store changed. Close and reopen its details.',409);
    if(!details){name=String(current?.name||name);country=currentCountry;code=(current?.store_code as string|null)??code;}
    if(body.action==='add'&&email){
      if((await client.query('SELECT id FROM learners WHERE email=$1',[email])).rows.length)throw new CourseError('This email already has an account. Assign it through Manage Users.',409);
      await client.query('INSERT INTO learners(id,name,email,password_hash,code_hash,store_id,country,entered_at,induction_enrolled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false)',[adminId,(name+' admin').slice(0,101),email,passwordHash,await hash(randomToken()),id,country,date]);
      await client.query("INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES($1,'site',$2,$3,$4,$5)",[adminId,country,id,actor.email,date]);
      await client.query('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES($1,$2,$3,$4)',[adminId,id,actor.email,date]);
    }
    const active=body.action==='edit'?(current?.active??existing?.active??true):body.action!=='archive';
    if(body.action==='edit'){
      await client.query(`INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at,store_code,admin_email)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country=excluded.country,
        store_code=excluded.store_code,admin_email=excluded.admin_email,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,[id,name,country,active,actor.email,date,code||null,email]);
      if(country!==currentCountry){
        await client.query('UPDATE learners SET country=$2 WHERE store_id=$1',[id,country]);
        await client.query("UPDATE reporting_access SET country=$2,updated_at=$3,assigned_by=$4 WHERE scope='site' AND site_id=$1",[id,country,date,actor.email]);
      }
    }else{
      await client.query('INSERT INTO organisation_stores(id,name,country,active,updated_by,updated_at,store_code,admin_learner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[id,name,country,active,actor.email,date,code||null,adminId]);
    }
    await client.query('SELECT ensure_store_credits($1,$2,$3,$4)',[id,name,country,code||null]);
    await client.query('UPDATE store_credit_accounts SET active=$2,store_name=$3,country=$4,store_code=$5 WHERE store_id=$1',[id,active,name,country,code||null]);
    await client.query('INSERT INTO organisation_store_audit(id,store_id,actor,action,recorded_at) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),id,actor.email,body.action,date]);
  });
  return json({stores:visible(acting,await storeDirectory(true,true)),adminCreated:body.action==='add'&&!!email,passwordSetupPending:body.action==='add'&&!!email&&!initialPassword});
}catch(error){if((error as {code?:string}).code==='23505')return failed(new CourseError((error as {constraint?:string}).constraint?.includes('code')?'This store code is already in use.':(error as {constraint?:string}).constraint?.includes('email')?'This email already has an account. Assign it through Manage Users.':'This store already exists.',409));return failed(error);}}
