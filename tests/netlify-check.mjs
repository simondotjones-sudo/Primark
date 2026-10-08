import assert from 'node:assert/strict';
import {adminOnlyChecks} from './admin-only-checks.mjs';
import { reportingChecks } from './reporting-checks.mjs';
import { registrationChecks } from './registration-checks.mjs';
import { passwordRecoveryChecks } from './password-recovery-checks.mjs';
import { coursePanelChecks } from './course-panel-checks.mjs';
import { platformAdminChecks } from './platform-admin-checks.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
const resolve=createRequire(import.meta.url).resolve;
const pg=new PGlite();for(const name of readdirSync('netlify/database/migrations').sort())await pg.exec(readFileSync('netlify/database/migrations/'+name+'/migration.sql','utf8'));
const context=new AsyncLocalStorage(), maps=new Map();
const pool={async query(sql,values=[]){const r=await pg.query(sql,values);return {rows:r.rows,rowCount:r.affectedRows};},async connect(){return {...this,release(){}};}};
function getStore(options){const name=typeof options==='string'?options:options.name;if(!maps.has(name))maps.set(name,new Map());const data=maps.get(name);return {async set(k,v){data.set(k,await new Response(v).arrayBuffer());},async setJSON(k,v){data.set(k,structuredClone(v));},async get(k,o){const v=data.get(k);return v===undefined?null:o?.type==='json'?structuredClone(v):v.slice(0);}};}
globalThis.__migrationTest={pool,getStore,cookie:()=>context.getStore()?.cookie||''};
process.env.PRIMARK_ADMIN_EMAIL='admin@example.test';process.env.PRIMARK_ADMIN_PASSWORD='fixture-secret-not-for-production';
const dir=mkdtempSync(join(tmpdir(),'primark-netlify-test-')),entry=join(dir,'entry.ts');
writeFileSync(entry,`export * as storage from '${process.cwd()}/lib/storage.ts';
export {ProfileContent} from '${process.cwd()}/components/profile-menu.tsx';
export * as profile from '${process.cwd()}/lib/profile.ts';
export * as database from '${process.cwd()}/lib/database.ts';
export * as auth from '${process.cwd()}/lib/admin-auth.ts';
export * as origin from '${process.cwd()}/lib/request-origin.ts';
export * as session from '${process.cwd()}/app/api/admin/session/route.ts';
export * as reporting from '${process.cwd()}/app/api/reporting/route.ts';
export * as reportTypes from '${process.cwd()}/lib/training-report-types.ts';
export * as prototype from '${process.cwd()}/app/api/prototype/route.ts';
export * as recovery from '${process.cwd()}/app/api/password-recovery/route.ts';
export * as organisation from '${process.cwd()}/app/api/admin/organisation/route.ts';
export * as directory from '${process.cwd()}/lib/store-directory.ts';
export * as users from '${process.cwd()}/app/api/users/route.ts';
export * as certificates from '${process.cwd()}/app/api/certificates/route.ts';
export * as content from '${process.cwd()}/app/scorm-content/[token]/[...path]/route.ts';
export * as access from '${process.cwd()}/app/api/admin/reporting-access/route.ts';
export * as learnerAuth from '${process.cwd()}/lib/learner-auth.ts';
export * as courseAccess from '${process.cwd()}/lib/course-access.ts';
export * as catalogue from '${process.cwd()}/lib/course-catalogue.ts';
export * as covers from '${process.cwd()}/lib/course-covers.ts';
export * as panelDetails from '${process.cwd()}/lib/course-panel-details.ts';
export {default as CourseMetadata} from '${process.cwd()}/components/course-metadata.tsx';
export {default as CourseProgress} from '${process.cwd()}/components/course-progress.tsx';
export * as manager from '${process.cwd()}/app/api/store/route.ts';
export * as courses from '${process.cwd()}/app/api/courses/route.ts';
export * as scorm from '${process.cwd()}/app/api/scorm/route.ts';
export * as courseAdmin from '${process.cwd()}/app/api/admin/courses/route.ts';
export * as packages from '${process.cwd()}/app/api/admin/packages/route.ts';
export * as photos from '${process.cwd()}/app/api/shot-list/photos/route.ts';
export * as shots from '${process.cwd()}/app/api/shot-list/route.ts';
export * as photoRead from '${process.cwd()}/app/api/shot-list/photos/[id]/route.ts';
export {default as edge} from '${process.cwd()}/lib/stored-files-edge.ts';
export * as lessons from '${process.cwd()}/lib/course.ts';
export {hash} from '${process.cwd()}/lib/server.ts';
export {default as stores} from '${process.cwd()}/lib/stores.json';`);
const nextMock=`export class NextRequest extends Request{};export class NextResponse extends Response{static json(data,options={}){return new this(JSON.stringify(data),{...options,headers:{'content-type':'application/json',...options.headers}})}get cookies(){return {set:(name,value,options)=>this.headers.append('set-cookie',name+'='+value+'; '+Object.entries(options).map(([k,v])=>k+'='+v).join('; ')),delete:name=>this.headers.append('set-cookie',name+'=; Max-Age=0')}}}`;
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},tsconfig:'tsconfig.json',plugins:[{name:'platform-mocks',setup(b){
b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:resolve(args.path),external:true}));
for(const name of ['@netlify/database','@netlify/blobs','next/server','next/headers','next/navigation'])b.onResolve({filter:new RegExp('^'+name+'$')},()=>({path:name,namespace:'test'}));
b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',contents:a.path==='@netlify/database'?'export const getDatabase=()=>({pool:globalThis.__migrationTest.pool})':a.path==='@netlify/blobs'?'export const getStore=globalThis.__migrationTest.getStore':a.path==='next/server'?nextMock:a.path==='next/navigation'?'export const redirect=(url)=>{throw new Error(url)}':`export const cookies=async()=>({get:name=>{const value=globalThis.__migrationTest.cookie().split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value?{value}:undefined;}});`}));
}}]});
const m=await import(join(dir,'bundle.mjs'));let passed=0;
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
function req(url,method='GET',body,cookie='',extra={}){const headers={origin:'https://test.invalid',...extra};if(cookie)headers.cookie=cookie;if(body&&! (body instanceof FormData))headers['content-type']='application/json';const r=new Request('https://test.invalid'+url,{method,headers,...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});r.nextUrl=new URL(r.url);r.cookies={get:name=>{const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value?{value}:undefined;}};return r;}
async function session(body,cookie='',extra={}){return context.run({cookie},()=>m.session.POST(req('/api/admin/session','POST',body,cookie,extra)));}
const query=(sql,...values)=>m.database.db().prepare(sql).bind(...values);
const invoke=(route,method,url,body,cookie='',extra={})=>context.run({cookie},()=>route[method](req(url,method,body,cookie,extra)));
const getReport=(cookie,params='')=>invoke(m.prototype,'GET','/api/prototype?view=dashboard&year=all'+params,undefined,cookie);
const getExport=(cookie,params='')=>invoke(m.prototype,'GET','/api/prototype?view=export&year=all'+params,undefined,cookie);
const cookieFrom=(response,name)=>response.headers.get('set-cookie')?.match(new RegExp('(?:^|, )'+name+'=([^;,]+)'))?.[1];
const loginAdmin=async(cookie='')=>{const res=await session({email:process.env.PRIMARK_ADMIN_EMAIL,password:process.env.PRIMARK_ADMIN_PASSWORD},cookie);assert.equal(res.status,200,await res.clone().text());return 'primark_admin='+cookieFrom(res,'primark_admin');};
await check('Postgres batch rolls back a partially failed write',async()=>{await assert.rejects(m.database.db().batch([m.database.db().prepare("INSERT INTO courses(id,title,audience_json,created_at,updated_at) VALUES('rollback','Test','{}','now','now')"),m.database.db().prepare('INSERT INTO missing_table VALUES(1)')]));assert.equal(await m.database.db().prepare("SELECT id FROM courses WHERE id='rollback'").first(),null);});
await check('SQL placeholders preserve quoted question marks',async()=>assert.equal(m.database.postgresSql("SELECT '?' AS literal, ? AS value, 'it''s ?' AS quoted"),"SELECT '?' AS literal, $1 AS value, 'it''s ?' AS quoted"));
let adminCookie;
await check('Netlify public Host works when Next.js retains another hostname, without trusting forwarded hosts',async()=>{
 const r=req('/api/admin/session','POST',{email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD},'',{host:'primark-induction.netlify.app',origin:'https://primark-induction.netlify.app','x-forwarded-proto':'https','sec-fetch-site':'same-origin'});
 r.nextUrl=new URL('http://deploy-alias.netlify.app:443/api/admin/session');
 assert.equal(m.origin.sameOrigin(r),true);
 const res=await context.run({cookie:''},()=>m.session.POST(r));
 assert.equal(res.status,200);assert(res.headers.get('set-cookie').includes('secure=true'));
 r.headers.set('origin','https://evil.invalid');r.headers.set('x-forwarded-host','evil.invalid');assert.equal(m.origin.sameOrigin(r),false);
 r.headers.set('origin','https://deploy-alias.netlify.app');assert.equal(m.origin.sameOrigin(r),false);
 r.headers.set('origin','https://primark-induction.netlify.app');r.headers.set('sec-fetch-site','cross-site');assert.equal(m.origin.sameOrigin(r),false);
 r.headers.set('sec-fetch-site','same-origin');r.headers.set('host','primark-induction.netlify.app,evil.invalid');assert.equal(m.origin.sameOrigin(r),false);
 const local=req('/');local.nextUrl=new URL('http://localhost:8888/');local.headers.set('host','localhost:8888');local.headers.set('origin','http://localhost:8888');assert.equal(m.origin.sameOrigin(local),true);assert.equal(m.origin.isSecureRequest(local),false);
 local.headers.set('origin','http://localhost:9999');assert.equal(m.origin.sameOrigin(local),false);
});
await check('Missing or short admin credentials explain how to configure Netlify',async()=>{const old=process.env.PRIMARK_ADMIN_PASSWORD;try{process.env.PRIMARK_ADMIN_PASSWORD='too-short';const res=await session({email:'admin@example.test',password:'too-short'});assert.equal(res.status,503);assert.match((await res.json()).error,/at least 16 characters/);}finally{process.env.PRIMARK_ADMIN_PASSWORD=old;}});
await check('Admin rejects wrong password, cross-origin sign-in and spoofed identity headers',async()=>{assert.equal((await session({email:'admin@example.test',password:'wrong'})).status,401);assert.equal((await session({email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD},'',{origin:'https://evil.invalid'})).status,403);assert.equal(await context.run({cookie:''},()=>m.auth.getAdminUser()),null);});
await check('Admin sign-in sets a secure session and password rotation revokes it',async()=>{const res=await session({email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD,returnTo:'//evil.invalid'});assert.equal(res.status,200);assert.equal((await res.json()).returnTo,'/admin/courses');assert(res.headers.get('set-cookie').includes('httpOnly=true'));assert(res.headers.get('set-cookie').includes('secure=true'));adminCookie=res.headers.get('set-cookie').split(';')[0];assert.equal((await context.run({cookie:adminCookie},()=>m.auth.getAdminUser())).email,'admin@example.test');const old=process.env.PRIMARK_ADMIN_PASSWORD;process.env.PRIMARK_ADMIN_PASSWORD='a-different-long-admin-secret';assert.equal(await context.run({cookie:adminCookie},()=>m.auth.getAdminUser()),null);process.env.PRIMARK_ADMIN_PASSWORD=old;});
await check('Admin logout revokes the database session',async()=>{assert.equal((await session({action:'logout'},adminCookie)).status,200);assert.equal(await context.run({cookie:adminCookie},()=>m.auth.getAdminUser()),null);});
await check('Admin login attempts are rate limited in Postgres',async()=>{for(let i=0;i<10;i++)await session({email:'admin@example.test',password:'wrong'});assert.equal((await session({email:'admin@example.test',password:'wrong'})).status,429);});
const learnerId='photo-learner',learnerToken='photo-token',store=m.stores.find(s=>s.country==='Ireland');
await m.database.db().prepare('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)').bind(learnerId,'Photo User','photo@example.test','no-login',store.id,store.country,new Date().toISOString()).run();
await m.database.db().prepare('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)').bind(await m.hash(learnerToken),learnerId,'2099-01-01').run();
const learnerCookie='primark_session='+learnerToken;
await check('Learner registration, returning sign-in, assessment and certificate persist in Postgres',async()=>{
 const registered=await m.prototype.POST(req('/api/prototype','POST',{action:'register',name:'New Learner',email:'new@example.test',storeId:store.id,country:store.country,registrationCode:' SaFeTy ',password:'My-fixture-password'}));assert.equal(registered.status,200);
 const logged=await m.prototype.POST(req('/api/prototype','POST',{action:'login',email:'new@example.test',password:'My-fixture-password'}));assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];
 for(const chapter of m.lessons.modules){const r=await m.prototype.POST(req('/api/prototype','POST',{action:'view',key:chapter.key},cookie));assert.equal(r.status,200);}
 const duplicate=await m.prototype.POST(req('/api/prototype','POST',{action:'view',key:'welcome'},cookie));assert.equal((await duplicate.json()).viewed.length,6);
 const graded=await m.prototype.POST(req('/api/prototype','POST',{action:'submit',answers:m.lessons.questions.map(q=>q.correct)},cookie));assert.deepEqual(await graded.json(),{score:20,passed:true});
 const row=await m.database.db().prepare('SELECT completed_at,certificate_token,best_score FROM learners WHERE email=?').bind('new@example.test').first();assert(row.completed_at&&row.certificate_token);assert.equal(row.best_score,20);
 const lower=await m.prototype.POST(req('/api/prototype','POST',{action:'submit',answers:m.lessons.questions.map(q=>(q.correct+1)%3)},cookie));assert.equal(lower.status,200);assert.equal((await m.database.db().prepare('SELECT best_score FROM learners WHERE email=?').bind('new@example.test').first()).best_score,20);
});
await query('DELETE FROM auth_limits').run();
const photoAdmin=await loginAdmin();
let photoId=crypto.randomUUID(),photoKey;
await check('Photo larger than request ceiling uploads in parts and downloads unchanged',async()=>{const bytes=new Uint8Array(5*1024*1024+17).fill(91);bytes.set([255,216,255]);for(let offset=0;offset<bytes.length;offset+=m.storage.CHUNK_SIZE){const form=new FormData();for(const [k,v] of Object.entries({module:1,slide:2,id:photoId,total:bytes.length,offset,name:'original.jpg'}))form.append(k,String(v));form.append('photo',new Blob([bytes.slice(offset,offset+m.storage.CHUNK_SIZE)]),'part');const res=await invoke(m.photos,'POST','/api/shot-list/photos',form,photoAdmin);assert([200,201].includes(res.status),await res.clone().text());if(offset+m.storage.CHUNK_SIZE>=bytes.length)assert.equal((await res.json()).photo.size,bytes.length);}const response=await context.run({cookie:photoAdmin},()=>m.photoRead.GET(req('/api/shot-list/photos/'+photoId,'GET',undefined,photoAdmin),{params:Promise.resolve({id:photoId})}));assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);photoKey=(await m.database.db().prepare('SELECT object_key FROM shot_photos WHERE id=?').bind(photoId).first()).object_key;});
await check('Unauthorised photo reads are rejected before any file access',async()=>{const res=await m.photoRead.GET(req('/api/shot-list/photos/'+photoId),{params:Promise.resolve({id:photoId})});assert.equal(res.status,403);});
await check('Byte ranges cross chunk boundaries and invalid ranges are rejected',async()=>{const object=await m.storage.photoBucket().get(photoKey,{range:new Headers({Range:'bytes=2097150-2097160'})});assert.equal((await object.arrayBuffer()).byteLength,11);await assert.rejects(m.storage.photoBucket().get(photoKey,{range:new Headers({Range:'bytes=999999999-'})}),m.storage.InvalidRange);});
await check('Incomplete uploads cannot become readable files',async()=>{const b=m.storage.photoBucket();await b.writeChunk('unfinished',0,new ArrayBuffer(m.storage.CHUNK_SIZE));await assert.rejects(b.complete('unfinished',m.storage.CHUNK_SIZE+1));assert.equal(await b.get('unfinished'),null);});
await check('reading course HTML or a buffer fetches each file chunk only once',async()=>{
 let reads=0;const bytes=new TextEncoder().encode('<html>Course</html>').buffer;
 const bucket=m.storage.createBucket({async get(key){if(key.startsWith('objects/'))return {size:bytes.byteLength,chunks:1};if(key.startsWith('parts/')){reads++;return bytes;}return null;}});
 const html=await bucket.get('scorm/immutable/index.html');assert.equal(await html.text(),'<html>Course</html>');assert.equal(reads,1);
 const binary=await bucket.get('scorm/immutable/bundle.js');assert.equal((await binary.arrayBuffer()).byteLength,bytes.byteLength);assert.equal(reads,2);
});
await check('Edge delivery checks app permission and streams files larger than 20 MB',async()=>{const bytes=new Uint8Array(22*1024*1024+3).fill(42);await m.storage.photoBucket().put('large-file',bytes);const res=await m.edge(req('/scorm-content/session/video.mp4'),{next:async r=>{assert.equal(r.headers.get('x-primark-storage-descriptor'),'1');return Response.json({key:'large-file',headers:{'Content-Type':'video/mp4'}});}});assert.equal(res.status,200);assert.equal((await res.arrayBuffer()).byteLength,bytes.length);const denied=await m.edge(req('/scorm-content/session/video.mp4'),{next:async()=>new Response('Denied',{status:401})});assert.equal(denied.status,401);});

// Exercise the real permission endpoints with independent learner/admin sessions.
let reportingAdmin=await loginAdmin();
const irelandStores=m.stores.filter(s=>s.country==='Ireland'), ireland2=irelandStores.find(s=>s.id!==store.id), uk=m.stores.find(s=>s.country==='United Kingdom');
const people=[['site-manager',store],['country-manager',store],['org-manager',store],['same-site',store],['other-irish-site',ireland2],['uk-person',uk]];
const userCookies={};
for(const [id,site] of people){await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)',id,id,id+'@example.test',await m.hash('TEST-CODE'),site.id,site.country,id==='uk-person'?'2019-01-01T00:00:00Z':new Date().toISOString()).run();await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(id+'-token'),id,'2099-01-01').run();userCookies[id]='primark_session='+id+'-token';}
for(const [email,site,date] of [['same-site@example.test',uk.id,'2026-01-01'],['uk-person@example.test',store.id,'2019-01-01'],['old-irish@example.test',store.id,'2026-01-01'],['old-uk@example.test',uk.id,'2019-01-01'],['unscoped@example.test',null,'2018-01-01']])await query('INSERT INTO legacy_completions(email,completed,completed_at,store_id,imported_at) VALUES(?,1,?,?,?)',email,date,site,'now').run();
const grant=(id,scope,extra={},cookie=reportingAdmin)=>invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:id,scope,...extra},cookie);
await check('Profile displays identity and only views permitted for each role',async()=>{
 const account={name:'Photo User',email:'photo@example.test',role:'Learner',site:store.name,platformAdmin:false,reportingAccess:null};
 const props={account,view:'learn',onView(){},onFilter(){},onSignOut(){}};
 const learner=renderToStaticMarkup(createElement(m.ProfileContent,props));assert(learner.includes('Photo User'));assert(learner.includes('Learner'));assert(learner.includes(store.name));assert(learner.includes('Sign out'));assert.equal((learner.match(/<select/g)||[]).length,1);assert(learner.includes('Language'));assert(!learner.includes('Reporting level'));assert(learner.includes('My Courses')); assert(!learner.includes('Shot list'));
 const reporting=renderToStaticMarkup(createElement(m.ProfileContent,{...props,account:{...account,reportingAccess:{scope:'country',country:'Ireland',siteId:null}}}));assert(reporting.includes('Reporting'));assert(!reporting.includes('Manage courses'));assert(!reporting.includes('Reporting access'));assert(!reporting.includes('Shot list'));
 const admin=renderToStaticMarkup(createElement(m.ProfileContent,{...props,account:{...account,platformAdmin:true,reportingAccess:{scope:'organisation',country:null,siteId:null}}}));for(const label of ['Reporting','Courses','Manage Users','Organisation','Platform administration'])assert(admin.includes(label));assert(!admin.includes('My Courses'));
});
await check('Profile scope controls restrict sites and reporting levels and produce usable links',async()=>{
 const siteAccess={scope:'site',country:store.country,siteId:store.id},countryAccess={scope:'country',country:'Ireland',siteId:null},orgAccess={scope:'organisation',country:null,siteId:null};
 const siteScope=m.profile.profileScope(siteAccess,{role:'global',country:uk.country,site:uk.id});assert.deepEqual(siteScope.roles,['site']);assert.deepEqual(siteScope.countries,['Ireland']);assert.deepEqual(siteScope.sites.map(s=>s.id),[store.id]);assert.deepEqual(siteScope.filter,{role:'site',country:'Ireland',site:store.id});
 const countryScope=m.profile.profileScope(countryAccess,{role:'site',country:uk.country,site:uk.id});assert.deepEqual(countryScope.roles,['country','site']);assert(countryScope.sites.every(s=>s.country==='Ireland'));assert(countryScope.sites.some(s=>s.id===ireland2.id));assert.notEqual(countryScope.filter.site,uk.id);
 const chosen=m.profile.profileScope(countryAccess,{role:'site',site:ireland2.id}).filter;assert.equal(chosen.site,ireland2.id);
 const globalScope=m.profile.profileScope(orgAccess,{role:'site',country:uk.country,site:uk.id});assert.deepEqual(globalScope.roles,['global','country','site']);assert.equal(globalScope.filter.site,uk.id);
 const link=new URL(m.profile.profileHref('report',chosen),'https://test.invalid');assert.equal(link.searchParams.get('view'),'report');assert.equal(link.searchParams.get('site'),ireland2.id);assert.equal(m.profile.profileHref('shots'),'/shot-list');
});
await check('Profile identity is derived from the active session and server reporting grant',async()=>{
 assert.equal((await (await invoke(m.prototype,'GET','/api/prototype?view=me')).json()).account,null);
 const learner=(await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,learnerCookie)).json()).account;assert.equal(learner.name,'Photo User');assert.equal(learner.role,'Learner');assert.equal(learner.site,store.name);assert.equal(learner.platformAdmin,false);
 const admin=(await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,reportingAdmin)).json()).account;assert.equal(admin.email,process.env.PRIMARK_ADMIN_EMAIL);assert.equal(admin.role,'Platform admin');assert.equal(admin.site,'All Primark');assert.equal(admin.platformAdmin,true);
});
await check('Platform admins can upload and update shot status with their own attribution; existing photos remain readable',async()=>{
 const photo=await query('SELECT uploaded_by,uploaded_by_admin,object_key FROM shot_photos WHERE id=?',photoId).first();assert.equal(photo.uploaded_by,null);assert.equal(photo.uploaded_by_admin,process.env.PRIMARK_ADMIN_EMAIL);assert(!photo.object_key.includes(process.env.PRIMARK_ADMIN_EMAIL));
 const body={module:1,slide:2,status:'complete',note:''};assert.equal((await invoke(m.shots,'POST','/api/shot-list',body,reportingAdmin)).status,200);
 const state=await query('SELECT updated_by,updated_by_admin FROM shot_states WHERE module_number=1 AND slide_number=2').first();assert.equal(state.updated_by,null);assert.equal(state.updated_by_admin,process.env.PRIMARK_ADMIN_EMAIL);
 await query('INSERT INTO shot_photos(id,module_number,slide_number,filename,mime_type,size,object_key,uploaded_by,uploaded_at) VALUES(?,1,2,?,?,?,?,?,?)','legacy-photo','old.jpg','image/jpeg',17,photoKey,learnerId,'2025-01-01').run();
 const data=await (await invoke(m.shots,'GET','/api/shot-list',undefined,reportingAdmin)).json();assert.equal(data.photos.find(p=>p.id==='legacy-photo').uploader_name,'Photo User');assert.equal(data.photos.find(p=>p.id===photoId).uploader_name,process.env.PRIMARK_ADMIN_EMAIL);
 assert.equal((await invoke(m.shots,'POST','/api/shot-list',body,reportingAdmin,{origin:'https://evil.invalid'})).status,403);assert.equal((await invoke(m.photos,'POST','/api/shot-list/photos',new FormData(),reportingAdmin,{origin:'https://evil.invalid'})).status,403);
});
await check('Learners and anonymous visitors cannot read reports, exports, course management or permission lists',async()=>{
 for(const cookie of ['',userCookies['same-site']]){
  assert.equal((await getReport(cookie)).status,403);assert.equal((await getExport(cookie)).status,403);
  assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,cookie)).status,403);
  assert.equal((await invoke(m.access,'GET','/api/admin/reporting-access',undefined,cookie)).status,403);
  const res=await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie);const data=await res.json();assert.equal(data.platformAdmin,false);assert.equal(data.reportingAccess,null);
 }
});
await check('Only platform admin can grant valid scopes and cross-origin role changes fail',async()=>{
 assert.equal((await grant('same-site','organisation',{},userCookies['same-site'])).status,403);
 assert.equal((await grant('missing','organisation')).status,400);
 assert.equal((await grant('site-manager','site',{siteId:'missing'})).status,400);
 assert.equal((await grant('site-manager','country',{country:'Atlantis'})).status,400);
 assert.equal((await grant('site-manager','platform-admin')).status,400);
 assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:'site-manager',scope:'organisation'},reportingAdmin,{origin:'https://evil.invalid'})).status,403);
 assert.equal((await grant('site-manager','site',{siteId:store.id,country:'United Kingdom'})).status,200);
 assert.equal((await grant('country-manager','country',{country:'Ireland'})).status,200);
 assert.equal((await grant('org-manager','organisation')).status,200);
 assert.equal((await query('SELECT country FROM reporting_access WHERE learner_id=?','site-manager').first()).country,'Ireland');
});
await check('Learners and every reporting-admin scope are denied shot-list data, updates, uploads and direct photos',async()=>{
 for(const cookie of ['',learnerCookie,userCookies['site-manager'],userCookies['country-manager'],userCookies['org-manager'],reportingAdmin+'; '+learnerCookie]){
  assert.equal((await invoke(m.shots,'GET','/api/shot-list',undefined,cookie)).status,403);
  assert.equal((await invoke(m.shots,'POST','/api/shot-list',{module:1,slide:2,status:'todo'},cookie)).status,403);
  assert.equal((await invoke(m.photos,'POST','/api/shot-list/photos',new FormData(),cookie)).status,403);
  for(const suffix of ['','?preview=1','?download=1'])for(const extra of [{},{'x-primark-storage-descriptor':'1'}]){
   const response=await context.run({cookie},()=>m.photoRead.GET(req('/api/shot-list/photos/'+photoId+suffix,'GET',undefined,cookie,extra),{params:Promise.resolve({id:photoId})}));assert.equal(response.status,403);
  }
 }
});
await check('Site reporting limits rows, counts, trends, years, legacy records and CSV to one site',async()=>{
 const cookie=userCookies['site-manager'],res=await getReport(cookie);assert.equal(res.status,200);const data=await res.json();
 assert(data.rows.length>0);assert(data.rows.every(p=>p.store_id===store.id));assert.equal(data.counts.entered,data.rows.length);
 assert(!data.years.includes(2019));assert(!data.years.includes(2018));assert.equal(data.counts.legacy,2);
 const csv=await (await getExport(cookie)).text();assert(csv.includes('same-site@example.test'));assert(csv.includes('old-irish@example.test'));assert(!csv.includes('uk-person@example.test'));assert(!csv.includes('old-uk@example.test'));assert(!csv.includes('unscoped@example.test'));
 for(const params of ['&role=global','&role=country&country=Ireland','&role=site&site='+ireland2.id,'&role=site&site='+uk.id]){assert.equal((await getReport(cookie,params)).status,403);assert.equal((await getExport(cookie,params)).status,403);}
});
await check('Country reporting permits its sites and rejects other countries and global reports',async()=>{
 const cookie=userCookies['country-manager'],data=await (await getReport(cookie)).json();assert(data.rows.every(p=>p.country==='Ireland'));assert(data.rows.some(p=>p.id==='other-irish-site'));assert(!data.years.includes(2019));
 assert.equal((await getReport(cookie,'&role=site&site='+ireland2.id)).status,200);
 for(const params of ['&role=global','&role=country&country=United+Kingdom','&role=site&site='+uk.id]){assert.equal((await getReport(cookie,params)).status,403);assert.equal((await getExport(cookie,params)).status,403);}
});
await check('Organisation reporting includes all locations but cannot manage courses, roles, imports or sample records',async()=>{
 const cookie=userCookies['org-manager'],data=await (await getReport(cookie)).json();assert(data.rows.some(p=>p.id==='uk-person'));assert(data.years.includes(2019));assert.equal(data.counts.legacy,5);
 assert.equal((await getReport(cookie,'&role=site&site='+uk.id)).status,200);
 for(const route of [m.courseAdmin,m.access])assert.equal((await invoke(route,'GET','/api/admin',undefined,cookie)).status,403);
 assert.equal((await invoke(m.packages,'POST','/api/admin/packages',{},cookie)).status,403);
 assert.equal((await grant('same-site','organisation',{},cookie)).status,403);
 for(const action of ['seed','import'])assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action},cookie)).status,403);
 const me=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();assert.equal(me.platformAdmin,false);assert.equal(me.reportingAccess.scope,'organisation');
});
await check('Changing and removing reporting access applies immediately to an existing session',async()=>{
 const cookie=userCookies['site-manager'];assert.equal((await grant('site-manager','site',{siteId:uk.id})).status,200);
 let res=await getReport(cookie);assert.equal(res.status,200);assert((await res.json()).rows.every(p=>p.store_id===uk.id));
 assert.equal((await getReport(cookie,'&role=site&site='+store.id)).status,403);
 assert.equal((await grant('site-manager','none')).status,200);assert.equal((await getReport(cookie)).status,403);assert.equal((await getExport(cookie)).status,403);
 const me=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();assert.equal(me.reportingAccess,null);assert(me.learner);
});
await check('Existing dual-cookie sessions cannot inherit platform-admin permissions',async()=>{
 const cookie=reportingAdmin+'; '+userCookies['same-site'];
 assert.equal(await context.run({cookie},()=>m.auth.getAdminUser()),null);
 assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,cookie)).status,403);
 assert.equal((await getReport(cookie)).status,403);
});
await check('Learner registration and sign-in end and revoke the previous platform session',async()=>{
 const res=await invoke(m.prototype,'POST','/api/prototype',{action:'register',name:'Switch User',email:'switch@example.test',storeId:store.id,country:store.country,registrationCode:'safety',password:'My-fixture-password'},reportingAdmin);assert.equal(res.status,200);assert(res.headers.get('set-cookie').includes('primark_admin=;'));
 assert.equal(await context.run({cookie:reportingAdmin},()=>m.auth.getAdminUser()),null);
 await query('UPDATE learners SET password_hash=? WHERE id=?',await m.learnerAuth.hashPassword('My-fixture-password'),'same-site').run();reportingAdmin=await loginAdmin();const logged=await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'same-site@example.test',password:'My-fixture-password'},reportingAdmin);assert.equal(logged.status,200);assert(logged.headers.get('set-cookie').includes('primark_admin=;'));
 assert.equal(await context.run({cookie:reportingAdmin},()=>m.auth.getAdminUser()),null);
});
await check('Platform sign-in clears learner cookies and revokes the learner session',async()=>{
 const cookie=userCookies['same-site'];const res=await session({email:process.env.PRIMARK_ADMIN_EMAIL,password:process.env.PRIMARK_ADMIN_PASSWORD},cookie);assert.equal(res.status,200);assert(res.headers.get('set-cookie').includes('primark_session=;'));
 const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();assert.equal(state.learner,null);
 reportingAdmin='primark_admin='+cookieFrom(res,'primark_admin');assert.equal((await getReport(reportingAdmin)).status,200);
});
await check('Learner logout clears both old cookies and cannot resurrect an admin session',async()=>{
 const res=await invoke(m.prototype,'POST','/api/prototype',{action:'logout'},reportingAdmin+'; '+userCookies['country-manager']);assert.equal(res.status,200);
 assert(res.headers.get('set-cookie').includes('primark_admin=;'));assert(res.headers.get('set-cookie').includes('primark_session=;'));
 assert.equal(await context.run({cookie:reportingAdmin},()=>m.auth.getAdminUser()),null);
});
await query('DELETE FROM auth_limits').run();
await registrationChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk,pg});
await coursePanelChecks({m,check,query,invoke,loginAdmin});
await query('DELETE FROM auth_limits').run();
const commonLogin=(body,cookie='',extra={})=>invoke(m.prototype,'POST','/api/prototype',{action:'login',...body},cookie,extra);
await check('Common Login recognises platform credentials, rotates sessions and returns a safe admin destination',async()=>{
 const learnerLogin=await commonLogin({email:'new@example.test',password:'My-fixture-password'});
 const oldLearner='primark_session='+cookieFrom(learnerLogin,'primark_session');
 const first=await commonLogin({email:' ADMIN@EXAMPLE.TEST ',password:process.env.PRIMARK_ADMIN_PASSWORD,returnTo:'/admin/reporting-access'},oldLearner);
 assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).returnTo,'/admin/reporting-access');
 assert(first.headers.get('set-cookie').includes('httpOnly=true'));assert(first.headers.get('set-cookie').includes('sameSite=strict'));assert(first.headers.get('set-cookie').includes('primark_session=;'));
 const admin='primark_admin='+cookieFrom(first,'primark_admin');
 const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,admin)).json();
 assert.equal(state.account.role,'Platform admin');assert.equal(state.platformAdmin,true);assert.equal(state.learner,null);
 assert.equal((await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,oldLearner)).json()).learner,null);
 assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,admin)).status,200);
 const second=await commonLogin({email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD,returnTo:'//evil.invalid'},admin);
 assert.equal((await second.json()).returnTo,'/admin/courses');assert.equal(await context.run({cookie:admin},()=>m.auth.getAdminUser()),null);
});
await check('Sharing an admin email does not elevate a learner password or posted role',async()=>{
 await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,password_hash) VALUES(?,?,?,?,?,?,?,?)','same-email','Ordinary Learner','admin@example.test','unusable',store.id,store.country,new Date().toISOString(),await m.learnerAuth.hashPassword('Ordinary-password')).run();
 const res=await commonLogin({email:'admin@example.test',password:'Ordinary-password',platformAdmin:true,role:'platform-admin',returnTo:'/admin/courses'});
 assert.equal(res.status,200);assert.equal((await res.json()).returnTo,undefined);
 const cookie='primark_session='+cookieFrom(res,'primark_session');
 const me=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();
 assert.equal(me.platformAdmin,false);assert.equal(me.account.role,'Learner');
 assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,cookie)).status,403);
});
await check('Common Login rejects wrong details and cross-origin requests and shares the admin rate limit',async()=>{
 await query('DELETE FROM auth_limits').run();
 const credentials={email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD};
 assert.equal((await commonLogin(credentials,'',{origin:'https://evil.invalid'})).status,403);
 assert.equal((await commonLogin({...credentials,email:'unknown@example.test'})).status,401);
 for(let i=0;i<5;i++){assert.equal((await commonLogin({...credentials,password:'wrong'})).status,401);assert.equal((await session({...credentials,password:'wrong'})).status,401);}
 assert.equal((await commonLogin(credentials)).status,429);assert.equal((await session(credentials)).status,429);
 await query('DELETE FROM auth_limits').run();
});
await check('Common Login preserves long configured admin passwords and old login bookmarks have safe redirects',async()=>{
 const previous=process.env.PRIMARK_ADMIN_PASSWORD;
 try {process.env.PRIMARK_ADMIN_PASSWORD='fixture-'.repeat(25);assert.equal((await commonLogin({email:'admin@example.test',password:process.env.PRIMARK_ADMIN_PASSWORD})).status,200);}
 finally {process.env.PRIMARK_ADMIN_PASSWORD=previous;}
 for(const value of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/admin/sign-in','/?login=1'])assert.equal(m.auth.safeReturnTo(value),'/admin/courses');
 await assert.rejects(context.run({cookie:''},()=>m.auth.requireAdminUser('/admin/courses')),/\/\?login=1&returnTo=%2Fadmin%2Fcourses/);
});
await reportingChecks({m,check,query,invoke,loginAdmin,store,uk});
await check('Organisation store lifecycle enforces admin access and preserves historical records',async()=>{
 const cookie=await loginAdmin();
 const endpoint='/api/admin/organisation';
 assert.equal((await invoke(m.organisation,'GET',endpoint)).status,403);
 assert.equal((await invoke(m.organisation,'POST',endpoint,{action:'add',name:'New Store',country:'Ireland'},userCookies['site-person'])).status,403);
 assert.equal((await invoke(m.organisation,'POST',endpoint,{action:'add',name:'New Store',country:'Ireland'},cookie,{origin:'https://evil.invalid'})).status,403);
 const result=await invoke(m.organisation,'POST',endpoint,{action:'add',name:'New Store',country:'Ireland'},cookie);assert.equal(result.status,200);
 const added=(await result.json()).stores.find(s=>s.name==='New Store');assert(added.active);
 assert.equal((await invoke(m.organisation,'POST',endpoint,{action:'add',name:'new store',country:'ireland'},cookie)).status,400);
 const before=(await query('SELECT COUNT(*) AS n FROM learners').first()).n;
 assert.equal((await invoke(m.organisation,'POST',endpoint,{action:'archive',id:store.id},cookie)).status,200);
 assert(!(await m.directory.storeDirectory(false)).some(s=>s.id===store.id));
 assert((await m.directory.storeDirectory()).some(s=>s.id===store.id));
 assert.equal((await query('SELECT COUNT(*) AS n FROM learners').first()).n,before);
 const registration=await invoke(m.prototype,'POST','/api/prototype',{action:'register',email:'archived@example.test',name:'Archive Test',storeId:store.id,country:store.country,registrationCode:'safety',password:'test-password-123'});
 assert.equal(registration.status,400);
 assert.equal((await invoke(m.organisation,'POST',endpoint,{action:'restore',id:store.id},cookie)).status,200);
 assert((await m.directory.storeDirectory(false)).some(s=>s.id===store.id));
 assert.equal((await query('SELECT COUNT(*) AS n FROM organisation_store_audit WHERE store_id=?',store.id).first()).n,2);
});
await platformAdminChecks({m,check,query,invoke,loginAdmin,cookieFrom,store});
await passwordRecoveryChecks({m,check,query,invoke,loginAdmin,cookieFrom,store});
await adminOnlyChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk});
console.log(`${passed} Netlify migration checks passed.`);await pg.close();rmSync(dir,{recursive:true,force:true});
