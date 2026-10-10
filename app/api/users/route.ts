import {csvDownload} from '@/lib/learner-import-csv';
import {jobRoles,validateJobRole} from '@/lib/job-roles';
import {syncAssignments,creditError} from '@/lib/credits';
import type { NextRequest } from 'next/server';
import { credentials } from '@/lib/admin-auth';
import { learnerOnlySql } from '@/lib/account-type';
import { allowedAdminRoles, canEditUsers, managedUsersSql, requireUserAdministrator, userColumns, userJoins, userRevision } from '@/lib/user-administration';
import { bodyJson, CourseError, failed, json } from '@/lib/course-admin';
import { db, hash, now, randomToken } from '@/lib/server';
import { hashPassword, normalizeWorkdayId, validPassword } from '@/lib/learner-auth';
import { storeDirectory } from '@/lib/store-directory';
import type {UserPerson} from '@/lib/user-administration-types';
import { changeUserAccess } from '@/lib/user-access';
import type { PreparedStatement } from '@/lib/database';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
  const actor=await requireUserAdministrator();
  const directory=await storeDirectory();
  const stores=directory.filter(s=>actor.access.scope==='organisation'||(actor.access.scope==='country'?s.country===actor.access.country:s.id===actor.access.siteId));
  const options={jobRoles:await jobRoles(),roles:allowedAdminRoles(actor),stores,access:actor.access,platformAdmin:actor.platformAdmin,canAssign:actor.platformAdmin||!!actor.managerStoreId,canEdit:canEditUsers(actor)};
  const params=request.nextUrl.searchParams;
  if(params.get('options')==='1')return json(options);
  const search=(params.get('search')||'').trim().slice(0,150).toLowerCase();
  const page=Number(params.get('page')||1),type=params.get('type')||'all',status=params.get('status')||'active';
  const country=params.get('country')||'',storeId=params.get('storeId')||'';
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Choose a valid page.');
  if(!['all','learner','admin'].includes(type)||!['active','archived'].includes(status))throw new CourseError('Choose an account type.');
  if(country&&!stores.some(s=>s.country===country)||storeId&&!stores.some(s=>s.id===storeId&&(!country||s.country===country)))throw new CourseError('You can manage accounts only within your assigned scope.',403);
  const scope=managedUsersSql(actor,directory),args=[...scope.args];
  let where=scope.sql+` AND l.archived_at IS ${status==='active'?'NULL':'NOT NULL'}`;
  if(type!=='all')where+=` AND ${type==='admin'?'NOT ':''}(${learnerOnlySql()})`;
  if(country){where+=' AND (l.country=? OR r.country=? OR m.store_id=ANY(?::text[]))';args.push(country,country,stores.filter(s=>s.country===country).map(s=>s.id));}
  if(storeId){where+=' AND (l.store_id=? OR r.site_id=? OR m.store_id=?)';args.push(storeId,storeId,storeId);}
  where+=" AND (?='' OR strpos(lower(l.name || ' ' || COALESCE(l.email,'') || ' ' || COALESCE(l.workday_id,'') || ' ' || COALESCE(l.legacy_access_code,'')),?)>0)";args.push(search,search);
  const jobRole=request.nextUrl.searchParams.get('jobRole')||'';
  if(jobRole==='none')where+=' AND l.job_role_id IS NULL';
  else if(jobRole){where+=' AND l.job_role_id=?';args.push(jobRole);}
  if(params.get('export')==='1'){
    const result=await db().prepare(`SELECT l.name,l.email,l.workday_id,l.country,l.store_id,l.archived_at,l.job_role_id,j.name AS job_role,j.external_code AS job_role_code ${userJoins} LEFT JOIN job_roles j ON j.id=l.job_role_id WHERE ${where} ORDER BY lower(l.name),l.id LIMIT 10001`).bind(...args).all<Record<string,unknown>>();
    if(result.results.length>10000)throw new CourseError('Narrow the filters to export at most 10,000 users.');
    const columns=['workday_id','name','email','store_code','country','job_role','job_role_id','job_role_code','status'];
    return new Response(csvDownload([columns,...result.results.map(p=>[p.workday_id,p.name,p.email,stores.find(s=>s.id===p.store_id)?.storeCode||'',p.country,p.job_role,p.job_role_id,p.job_role_code,p.archived_at?'archived':'active'])]),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="users.csv"','Cache-Control':'private, no-store'}});
  }
  const pageSize=25;
  const [people,count]=await Promise.all([
    db().prepare(`SELECT ${userColumns},NOT (${learnerOnlySql()}) AS admin_only ${userJoins} WHERE ${where} ORDER BY lower(l.name),l.id LIMIT ? OFFSET ?`).bind(...args,pageSize,(page-1)*pageSize).all<UserPerson>(),
    db().prepare(`SELECT COUNT(*)::int AS total,COUNT(DISTINCT NULLIF(l.store_id,''))::int AS stores,COUNT(DISTINCT NULLIF(l.country,''))::int AS countries ${userJoins} WHERE ${where}`).bind(...args).first<{total:number;stores:number;countries:number}>(),
  ]);
  return json({...options,people:people.results.map(p=>({...p,revision:userRevision(p),canEdit:options.canEdit&&!p.archived_at&&p.id!==actor.id&&p.email!==actor.email&&p.email!==credentials()?.email,canEditDetails:!p.archived_at&&p.id!==actor.id&&p.email!==actor.email&&p.email!==credentials()?.email,canArchive:p.id!==actor.id&&p.email!==actor.email&&p.email!==credentials()?.email})),total:count?.total||0,summary:count,page,pageSize});
}catch(error){return failed(creditError(error));}}

export async function PATCH(request:NextRequest){try{
  const actor=await requireUserAdministrator(request);
  await changeUserAccess(actor,await bodyJson(request,10000));
  return json({ok:true});
}catch(error){return failed(creditError(error));}}

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
  const jobRoleId=await validateJobRole(body.jobRoleId);
  const id=crypto.randomUUID(),date=now();
  const start=body.startDate;
  if(start!==undefined&&start!==''&&(typeof start!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start))||new Date(start).toISOString().slice(0,10)!==start||start>date.slice(0,10)))throw new CourseError('Choose a start date no later than today.');
  const changes:PreparedStatement[]=[db().prepare("SELECT set_config('app.audit_actor',?,true)").bind(actor.email),db().prepare(`INSERT INTO learners(id,name,email,code_hash,password_hash,store_id,country,entered_at,induction_enrolled,workday_id,job_role_id)
    VALUES(?,?,?,?,?,?,?,?,true,?,?)`).bind(id,name,email,await hash(randomToken()),await hashPassword(body.password),storeId,country||'',date,workdayId,jobRoleId)];
  changes.push(db().prepare('UPDATE learners SET employment_started_on=? WHERE id=?').bind(start||date.slice(0,10),id));
  if(role==='platform')changes.push(db().prepare('INSERT INTO platform_admins(learner_id,assigned_by,updated_at) VALUES(?,?,?)').bind(id,actor.email,date));
  else if(adminOnly){
    changes.push(db().prepare('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES(?,?,?,?,?,?)').bind(id,role,country,role==='site'?storeId:null,actor.email,date));
    if(role==='site')changes.push(db().prepare('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES(?,?,?,?)').bind(id,storeId,actor.email,date));
  }
  // Account and grant are committed together: an admin can never briefly become a learner.
  if(!adminOnly)changes.push(syncAssignments(id));
  try {await db().batch(changes);}catch(error){
    if((error as {code?:string}).code==='23505')throw new CourseError('An account with these details already exists.',409);
    throw error;
  }
  return json({id,adminOnly},201);
}catch(error){return failed(creditError(error));}}
