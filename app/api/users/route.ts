import type { NextRequest } from 'next/server';
import { credentials } from '@/lib/admin-auth';
import { learnerOnlySql } from '@/lib/account-type';
import { allowedAdminRoles, requireUserAdministrator } from '@/lib/user-administration';
import { bodyJson, CourseError, failed, json } from '@/lib/course-admin';
import { db, hash, now, randomToken } from '@/lib/server';
import { hashPassword, normalizeWorkdayId, validPassword } from '@/lib/learner-auth';
import { storeDirectory } from '@/lib/store-directory';
import type { PreparedStatement } from '@/lib/database';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
  const actor=await requireUserAdministrator();
  const directory=await storeDirectory(false);
  const stores=directory.filter(s=>actor.access.scope==='organisation'||(actor.access.scope==='country'?s.country===actor.access.country:s.id===actor.access.siteId));
  const options={roles:allowedAdminRoles(actor),stores,access:actor.access,platformAdmin:actor.platformAdmin,canAssign:actor.platformAdmin||!!actor.managerStoreId};
  if(request.nextUrl.searchParams.get('options')==='1')return json(options);
  const search=(request.nextUrl.searchParams.get('search')||'').trim().slice(0,150).toLowerCase();
  const page=Number(request.nextUrl.searchParams.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Choose a valid page.');
  const args:unknown[]=[];
  let scope='1=1';
  if(!actor.platformAdmin){
    scope='NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id)';
    if(actor.access.scope!=='organisation'){
      // Evaluate an admin's grant as well as their home store. A home store never
      // lets a lower-level admin discover or manage a wider-scope account.
      const isCountry=actor.access.scope==='country';
      scope+=` AND (l.store_id IN (${stores.map(()=>'?').join(',')||'NULL'})
          ${isCountry?"OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='country' AND r.country=?)":''})
        AND NOT EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND ${isCountry?"(r.scope='organisation' OR r.country<>?)":"(r.scope<>'site' OR r.site_id<>?)"})
        AND NOT EXISTS(SELECT 1 FROM store_managers m WHERE m.learner_id=l.id AND m.store_id NOT IN (${stores.map(()=>'?').join(',')||'NULL'}))`;
      args.push(...stores.map(s=>s.id),...(isCountry?[actor.access.country]:[]),isCountry?actor.access.country:actor.access.siteId,...stores.map(s=>s.id));
    }
  }
  const where=`${scope} AND (?='' OR strpos(lower(l.name || ' ' || l.email || ' ' || COALESCE(l.workday_id,'')),?)>0)`;
  args.push(search,search);
  const [people,count]=await Promise.all([
    db().prepare(`SELECT l.id,l.name,l.email,l.store_id,l.country,NOT (${learnerOnlySql()}) AS admin_only
      FROM learners l WHERE ${where} ORDER BY lower(l.name),l.id LIMIT 50 OFFSET ?`).bind(...args,(page-1)*50).all(),
    db().prepare(`SELECT COUNT(*)::int AS total,COUNT(DISTINCT NULLIF(l.store_id,''))::int AS stores,COUNT(DISTINCT NULLIF(l.country,''))::int AS countries FROM learners l WHERE ${where}`).bind(...args).first<{total:number;stores:number;countries:number}>(),
  ]);
  return json({...options,people:people.results,total:count?.total||0,summary:count,page,pageSize:50});
}catch(error){return failed(error);}}

export async function POST(request:NextRequest) {try {
  const actor=await requireUserAdministrator(request);
  const body=await bodyJson(request,10000);
  if(!['learner','admin'].includes(body.accountType))throw new CourseError('Choose an account type.');
  const adminOnly=body.accountType==='admin';
  const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(name.length<2||name.length>101||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new CourseError('Enter your name and a valid email.');
  if(!validPassword(body.password)||(adminOnly&&body.password.length<16))throw new CourseError(adminOnly?'Admin passwords need 16–128 characters.':'Create a password with 8–128 characters.');
  const role=adminOnly?body.role:'none';
  if(adminOnly&&!allowedAdminRoles(actor).includes(role))throw new CourseError('You cannot grant this level of access.',403);
  const stores=await storeDirectory(false);
  const site=stores.find(s=>s.id===body.storeId);
  let storeId='',country:string|null=null;
  if(!adminOnly||role==='site'){
    if(!site)throw new CourseError('Choose a store.');
    storeId=site.id;country=site.country;
  }else if(role==='country'){
    if(typeof body.country!=='string'||!stores.some(s=>s.country===body.country))throw new CourseError('Choose a country from the directory.');
    country=body.country;
  }
  if(actor.access.scope==='site'&&storeId!==actor.access.siteId || actor.access.scope==='country'&&country!==actor.access.country)
    throw new CourseError('You can create accounts only within your assigned scope.',403);
  const workdayId=adminOnly?null:normalizeWorkdayId(body.workdayId);
  if(!adminOnly&&body.workdayId&& !workdayId)throw new CourseError('Check your Workday ID, or leave it blank.');
  if(email===credentials()?.email || await db().prepare('SELECT id FROM learners WHERE email=?').bind(email).first())throw new CourseError('This email is already registered.',409);
  if(workdayId&&await db().prepare('SELECT id FROM learners WHERE workday_id=?').bind(workdayId).first())throw new CourseError('This Workday ID is already linked to an account. Log in, or leave it blank to continue with email.',409);
  const id=crypto.randomUUID(),date=now();
  const changes:PreparedStatement[]=[db().prepare(`INSERT INTO learners(id,name,email,code_hash,password_hash,store_id,country,entered_at,induction_enrolled,workday_id)
    VALUES(?,?,?,?,?,?,?,?,true,?)`).bind(id,name,email,await hash(randomToken()),await hashPassword(body.password),storeId,country||'',date,workdayId)];
  if(role==='platform')changes.push(db().prepare('INSERT INTO platform_admins(learner_id,assigned_by,updated_at) VALUES(?,?,?)').bind(id,actor.email,date));
  else if(adminOnly){
    changes.push(db().prepare('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES(?,?,?,?,?,?)').bind(id,role,country,role==='site'?storeId:null,actor.email,date));
    if(role==='site')changes.push(db().prepare('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES(?,?,?,?)').bind(id,storeId,actor.email,date));
  }
  // Account and grant are committed together: an admin can never briefly become a learner.
  try {await db().batch(changes);}catch(error){
    if((error as {code?:string}).code==='23505')throw new CourseError('An account with these details already exists.',409);
    throw error;
  }
  return json({id,adminOnly},201);
}catch(error){return failed(error);}}
