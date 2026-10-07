import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const pg=new PGlite();await pg.exec(readFileSync('netlify/database/migrations/001_initial-schema/migration.sql','utf8'));
const context=new AsyncLocalStorage(), maps=new Map();
const pool={async query(sql,values=[]){const r=await pg.query(sql,values);return {rows:r.rows,rowCount:r.affectedRows};},async connect(){return {...this,release(){}};}};
function getStore(options){const name=typeof options==='string'?options:options.name;if(!maps.has(name))maps.set(name,new Map());const data=maps.get(name);return {async set(k,v){data.set(k,await new Response(v).arrayBuffer());},async setJSON(k,v){data.set(k,structuredClone(v));},async get(k,o){const v=data.get(k);return v===undefined?null:o?.type==='json'?structuredClone(v):v.slice(0);}};}
globalThis.__migrationTest={pool,getStore,cookie:()=>context.getStore()?.cookie||''};
process.env.PRIMARK_ADMIN_EMAIL='admin@example.test';process.env.PRIMARK_ADMIN_PASSWORD='fixture-secret-not-for-production';
const dir=mkdtempSync(join(tmpdir(),'primark-netlify-test-')),entry=join(dir,'entry.ts');
writeFileSync(entry,`export * as storage from '${process.cwd()}/lib/storage.ts';
export * as database from '${process.cwd()}/lib/database.ts';
export * as auth from '${process.cwd()}/lib/admin-auth.ts';
export * as origin from '${process.cwd()}/lib/request-origin.ts';
export * as session from '${process.cwd()}/app/api/admin/session/route.ts';
export * as prototype from '${process.cwd()}/app/api/prototype/route.ts';
export * as photos from '${process.cwd()}/app/api/shot-list/photos/route.ts';
export * as photoRead from '${process.cwd()}/app/api/shot-list/photos/[id]/route.ts';
export {default as edge} from '${process.cwd()}/lib/stored-files-edge.ts';
export * as lessons from '${process.cwd()}/lib/course.ts';
export {hash} from '${process.cwd()}/lib/server.ts';
export {default as stores} from '${process.cwd()}/lib/stores.json';`);
const nextMock=`export class NextRequest extends Request{};export class NextResponse extends Response{static json(data,options={}){return new this(JSON.stringify(data),{...options,headers:{'content-type':'application/json',...options.headers}})}get cookies(){return {set:(name,value,options)=>this.headers.append('set-cookie',name+'='+value+'; '+Object.entries(options).map(([k,v])=>k+'='+v).join('; ')),delete:name=>this.headers.append('set-cookie',name+'=; Max-Age=0')}}}`;
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',tsconfig:'tsconfig.json',plugins:[{name:'platform-mocks',setup(b){
for(const name of ['@netlify/database','@netlify/blobs','next/server','next/headers','next/navigation'])b.onResolve({filter:new RegExp('^'+name+'$')},()=>({path:name,namespace:'test'}));
b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',contents:a.path==='@netlify/database'?'export const getDatabase=()=>({pool:globalThis.__migrationTest.pool})':a.path==='@netlify/blobs'?'export const getStore=globalThis.__migrationTest.getStore':a.path==='next/server'?nextMock:a.path==='next/navigation'?'export const redirect=(url)=>{throw new Error(url)}':`export const cookies=async()=>({get:name=>{const value=globalThis.__migrationTest.cookie().split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value?{value}:undefined;}});`}));
}}]});
const m=await import(join(dir,'bundle.mjs'));let passed=0;
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
function req(url,method='GET',body,cookie='',extra={}){const headers={origin:'https://test.invalid',...extra};if(cookie)headers.cookie=cookie;if(body&&! (body instanceof FormData))headers['content-type']='application/json';const r=new Request('https://test.invalid'+url,{method,headers,...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});r.nextUrl=new URL(r.url);r.cookies={get:name=>{const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value?{value}:undefined;}};return r;}
async function session(body,cookie='',extra={}){return context.run({cookie},()=>m.session.POST(req('/api/admin/session','POST',body,cookie,extra)));}
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
 const registered=await m.prototype.POST(req('/api/prototype','POST',{action:'register',name:'New Learner',email:'new@example.test',storeId:store.id}));assert.equal(registered.status,200);const {code}=await registered.json();
 const logged=await m.prototype.POST(req('/api/prototype','POST',{action:'login',email:'new@example.test',code}));assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];
 for(const chapter of m.lessons.modules){const r=await m.prototype.POST(req('/api/prototype','POST',{action:'view',key:chapter.key},cookie));assert.equal(r.status,200);}
 const duplicate=await m.prototype.POST(req('/api/prototype','POST',{action:'view',key:'welcome'},cookie));assert.equal((await duplicate.json()).viewed.length,6);
 const graded=await m.prototype.POST(req('/api/prototype','POST',{action:'submit',answers:m.lessons.questions.map(q=>q.correct)},cookie));assert.deepEqual(await graded.json(),{score:20,passed:true});
 const row=await m.database.db().prepare('SELECT completed_at,certificate_token,best_score FROM learners WHERE email=?').bind('new@example.test').first();assert(row.completed_at&&row.certificate_token);assert.equal(row.best_score,20);
 const lower=await m.prototype.POST(req('/api/prototype','POST',{action:'submit',answers:m.lessons.questions.map(q=>(q.correct+1)%3)},cookie));assert.equal(lower.status,200);assert.equal((await m.database.db().prepare('SELECT best_score FROM learners WHERE email=?').bind('new@example.test').first()).best_score,20);
});
let photoId=crypto.randomUUID(),photoKey;
await check('Photo larger than request ceiling uploads in parts and downloads unchanged',async()=>{const bytes=new Uint8Array(5*1024*1024+17).fill(91);bytes.set([255,216,255]);for(let offset=0;offset<bytes.length;offset+=m.storage.CHUNK_SIZE){const form=new FormData();for(const [k,v] of Object.entries({module:1,slide:2,id:photoId,total:bytes.length,offset,name:'original.jpg'}))form.append(k,String(v));form.append('photo',new Blob([bytes.slice(offset,offset+m.storage.CHUNK_SIZE)]),'part');const res=await m.photos.POST(req('/api/shot-list/photos','POST',form,learnerCookie));assert([200,201].includes(res.status),await res.clone().text());if(offset+m.storage.CHUNK_SIZE>=bytes.length)assert.equal((await res.json()).photo.size,bytes.length);}const response=await m.photoRead.GET(req('/api/shot-list/photos/'+photoId,'GET',undefined,learnerCookie),{params:Promise.resolve({id:photoId})});assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);photoKey=(await m.database.db().prepare('SELECT object_key FROM shot_photos WHERE id=?').bind(photoId).first()).object_key;});
await check('Unauthorised photo reads are rejected before any file access',async()=>{const res=await m.photoRead.GET(req('/api/shot-list/photos/'+photoId),{params:Promise.resolve({id:photoId})});assert.equal(res.status,401);});
await check('Byte ranges cross chunk boundaries and invalid ranges are rejected',async()=>{const object=await m.storage.photoBucket().get(photoKey,{range:new Headers({Range:'bytes=2097150-2097160'})});assert.equal((await object.arrayBuffer()).byteLength,11);await assert.rejects(m.storage.photoBucket().get(photoKey,{range:new Headers({Range:'bytes=999999999-'})}),m.storage.InvalidRange);});
await check('Incomplete uploads cannot become readable files',async()=>{const b=m.storage.photoBucket();await b.writeChunk('unfinished',0,new ArrayBuffer(m.storage.CHUNK_SIZE));await assert.rejects(b.complete('unfinished',m.storage.CHUNK_SIZE+1));assert.equal(await b.get('unfinished'),null);});
await check('Edge delivery checks app permission and streams files larger than 20 MB',async()=>{const bytes=new Uint8Array(22*1024*1024+3).fill(42);await m.storage.photoBucket().put('large-file',bytes);const res=await m.edge(req('/scorm-content/session/video.mp4'),{next:async r=>{assert.equal(r.headers.get('x-primark-storage-descriptor'),'1');return Response.json({key:'large-file',headers:{'Content-Type':'video/mp4'}});}});assert.equal(res.status,200);assert.equal((await res.arrayBuffer()).byteLength,bytes.length);const denied=await m.edge(req('/scorm-content/session/video.mp4'),{next:async()=>new Response('Denied',{status:401})});assert.equal(denied.status,401);});
console.log(`${passed} Netlify migration checks passed.`);await pg.close();rmSync(dir,{recursive:true,force:true});
