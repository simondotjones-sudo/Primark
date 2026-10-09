// The named sample-account data migration is covered separately by sample-completion-check.mjs.
import { certificateChecks } from './certificate-checks.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);

const dir=mkdtempSync(join(tmpdir(),'primark-course-check-'));
const pg=new PGlite();
for(const name of readdirSync('netlify/database/migrations').sort().filter(name=>name!=='20261009160000_sample-learner-induction-completion'))await pg.exec(readFileSync('netlify/database/migrations/'+name+'/migration.sql','utf8'));
const context=new AsyncLocalStorage();
const pool={async query(sql,values=[]){const result=await pg.query(sql,values);return {rows:result.rows,rowCount:result.affectedRows};},async connect(){return {...this,release(){}};}};
const blobs=new Map();
const store={async set(key,value){blobs.set(key,await new Response(value).arrayBuffer());},async setJSON(key,value){blobs.set(key,structuredClone(value));},async get(key,options){const value=blobs.get(key);if(value===undefined)return null;return options?.type==='json'?structuredClone(value):value.slice(0);}};
globalThis.__courseTest={pool,store,cookie:()=>context.getStore()?.user,user:()=>context.getStore()?.admin?{email:'admin@example.test'}:null};
async function query(sql,...values){let n=0;return pool.query(sql.replace(/\?/g,()=>'$'+(++n)),values);}
async function first(sql,...values){return (await query(sql,...values)).rows[0];}
const entry=join(dir,'entry.ts');
writeFileSync(entry,`export {default as certificatePage} from '${process.cwd()}/app/certificates/[token]/page.tsx';
export * as certificates from '${process.cwd()}/app/api/certificates/route.ts';
export * as certificateServer from '${process.cwd()}/lib/certificate-server.ts';
export * as certificateTypes from '${process.cwd()}/lib/certificates.ts';
export * as training from '${process.cwd()}/lib/training-report.ts';
export * as reportTypes from '${process.cwd()}/lib/training-report-types.ts';
export * as admin from '${process.cwd()}/app/api/admin/courses/route.ts';
export * as packages from '${process.cwd()}/app/api/admin/packages/route.ts';
export * as upload from '${process.cwd()}/app/api/admin/packages/[id]/files/route.ts';
export * as courses from '${process.cwd()}/app/api/courses/route.ts';
export * as runtime from '${process.cwd()}/app/api/scorm/route.ts';
export * as content from '${process.cwd()}/app/scorm-content/[token]/[...path]/route.ts';
export * as api from '${process.cwd()}/lib/scorm-runtime.ts';
export * as manifest from '${process.cwd()}/lib/scorm-manifest.ts';
export * as types from '${process.cwd()}/lib/course-types.ts';
export * as rise from '${process.cwd()}/lib/rise-progress.ts';
export {hash} from '${process.cwd()}/lib/server.ts';
export {default as stores} from '${process.cwd()}/lib/stores.json';`);
await build({entryPoints:[entry],outfile:join(dir,'bundle.mjs'),bundle:true,platform:'node',format:'esm',packages:'bundle',tsconfig:'tsconfig.json',loader:{'.css':'empty'},plugins:[{name:'local-test-bindings',setup(b){
 b.onResolve({filter:/^qrcode$/},()=>({path:require.resolve('qrcode'),external:true}));
 b.onResolve({filter:/^@netlify\/database$/},()=>({path:'db',namespace:'test'}));
 b.onResolve({filter:/^@netlify\/blobs$/},()=>({path:'blobs',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/admin-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'test'}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'test'}));
 b.onResolve({filter:/^next\/server$/},()=>({path:'next',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='headers'?`export const cookies=async()=>({get:()=>globalThis.__courseTest.cookie()?{value:globalThis.__courseTest.cookie()}:undefined});`:a.path==='navigation'?`export const redirect=()=>{throw new Error('redirect')};export const notFound=()=>{throw new Error('not-found')};`:a.path==='db'?'export const getDatabase=()=>({pool:globalThis.__courseTest.pool});':a.path==='blobs'?'export const getStore=()=>globalThis.__courseTest.store;':a.path==='auth'?'export const getAdminUser=async()=>globalThis.__courseTest.user();':`export class NextRequest extends Request{};export const NextResponse=Response;`,loader:'js'}));
}}]});
const m=await import(join(dir,'bundle.mjs'));
let tests=0;
async function check(name,fn){await fn();console.log('PASS '+name);tests++;}
async function call(mod,method,body,{admin=false,user='',url='https://local.test/api',params,origin='https://local.test'}={}){return context.run({admin},async()=>{const req=new Request(url,{method,headers:{...(body instanceof Uint8Array?{'Content-Length':String(body.length)}:{'Content-Type':'application/json'}),...(user?{cookie:'primark_session='+user}:{}),origin},...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})});req.nextUrl=new URL(req.url);req.cookies={get:name=>name==='primark_session'&&user?{value:user}:undefined};const res=await mod[method](req,{params:Promise.resolve(params||{})});return {status:res.status,data:res.headers.get('content-type')?.includes('json')?await res.json():await res.text(),headers:res.headers};});}
const ireland=m.stores.find(s=>s.country==='Ireland'),uk=m.stores.find(s=>s.country==='United Kingdom'),france=m.stores.find(s=>s.country==='France');
async function learner(id,site){await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)',id,id,id+'@example.test','test-code',site.id,site.country,new Date().toISOString());await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(id),id,'2099-01-01T00:00:00.000Z');}
await learner('irish-user',ireland);await learner('uk-user',uk);await learner('fr-user',france);
let course,pack;
const manifest=`<?xml version="1.0"?><manifest xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata><organizations default="org"><organization identifier="org"><title>Fixture</title><item identifier="sco-one" identifierref="res"><title>Safety lesson</title><adlcp:masteryscore>80</adlcp:masteryscore></item></organization></organizations><resources><resource identifier="res" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
const files={'imsmanifest.xml':manifest,'index.html':'<!doctype html><html><head><title>Fixture</title></head><body>SCORM fixture</body></html>','assets/data.json':'{"ready":true}'};
await check('admin endpoints reject anonymous and learner sessions',async()=>{assert.equal((await call(m.admin,'GET')).status,403);assert.equal((await call(m.admin,'GET',undefined,{user:'irish-user'})).status,403);assert.equal((await call(m.packages,'POST',{}, {user:'irish-user'})).status,403);});
await check('admin writes reject cross-origin requests',async()=>assert.equal((await call(m.admin,'POST',{}, {admin:true,origin:'https://evil.test'})).status,403));
await check('create persistent draft and prevent premature publication',async()=>{const r=await call(m.admin,'POST',{title:'Fixture course',description:'Course test',status:'draft',audience:{countries:['Ireland'],sites:[ireland.id,uk.id],users:['irish-user']}},{admin:true});assert.equal(r.status,200);course=r.data.course;const p=await call(m.admin,'POST',{...course,audience:JSON.parse(course.audience_json),status:'published'},{admin:true});assert.equal(p.status,400);});
await check('reject ZIP traversal, incorrect version and missing launch files',async()=>{assert.equal(m.types.validPath('../escape.html'),false);assert.equal(m.types.validPath('assets\\bad.js'),false);assert.throws(()=>m.manifest.parseManifest(manifest.replace('1.2</','2004</'),new Set(Object.keys(files))));assert.throws(()=>m.manifest.parseManifest(manifest,new Set(['imsmanifest.xml'])));assert.throws(()=>m.manifest.parseManifest('<!DOCTYPE a>'+manifest,new Set(Object.keys(files))));});
await check('stage upload, enforce completeness, store files and validate SCORM',async()=>{const r=await call(m.packages,'POST',{courseId:course.id,filename:'fixture.zip',files:Object.entries(files).map(([path,v])=>({path,size:new TextEncoder().encode(v).length}))},{admin:true});assert.equal(r.status,200);pack=r.data.id;assert.equal((await call(m.packages,'POST',{action:'finish',id:pack},{admin:true})).status,400);for(const [path,v] of Object.entries(files)){const r=await call(m.upload,'PUT',new TextEncoder().encode(v),{admin:true,params:{id:pack},url:'https://local.test/api?path='+encodeURIComponent(path)});assert.equal(r.status,200,JSON.stringify(r.data));}const done=await call(m.packages,'POST',{action:'finish',id:pack},{admin:true});assert.equal(done.status,200,JSON.stringify(done.data));course=done.data.course;assert.equal(JSON.parse(done.data.package.scos_json)[0].mastery,'80');});
await check('draft courses are hidden and cannot be launched by learners',async()=>{assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.length,0);assert.equal((await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'irish-user'})).status,403);});
await check('publish once per matching user and cover future joiners',async()=>{const p=await call(m.admin,'POST',{...course,audience:JSON.parse(course.audience_json),status:'published'},{admin:true});assert.equal(p.status,200);course=p.data.course;assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.length,1);assert.equal((await call(m.courses,'GET',undefined,{user:'uk-user'})).data.courses.length,1);assert.equal((await call(m.courses,'GET',undefined,{user:'fr-user'})).data.courses.length,0);await learner('future-user',ireland);assert.equal((await call(m.courses,'GET',undefined,{user:'future-user'})).data.courses.length,1);});
await check('learner cannot launch unassigned course or overwrite package',async()=>{assert.equal((await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'fr-user'})).status,403);assert.equal((await call(m.upload,'PUT',new Uint8Array(0),{admin:true,params:{id:pack},url:'https://local.test/api?path=index.html'})).status,409);});
let launch;
await check('launch permits SCORM frame communication and installs runtime before course scripts',async()=>{const r=await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'irish-user'});assert.equal(r.status,200);launch=r.data;const c=await call(m.content,'GET',undefined,{params:{token:launch.token,path:['index.html']}});assert.equal(c.status,200);assert(c.data.indexOf('installScormRuntime')<c.data.indexOf('<title>Fixture'));assert(c.headers.get('content-security-policy').includes('sandbox allow-scripts'));assert(c.headers.get('content-security-policy').includes('allow-same-origin'));assert(!c.headers.get('content-security-policy').includes('allow-top-navigation'));assert(readFileSync('app/learn/[id]/player.tsx','utf8').includes('sandbox="allow-scripts allow-same-origin'));});
let data;
await check('SCORM API validation, commit and resume data',async()=>{const sent=[];const win={parent:{postMessage:v=>sent.push(v)},addEventListener(){},frames:[]};const initial=m.api.initialData('irish-user','Irish User','80','');vm.runInNewContext(`(${m.api.installScormRuntime.toString()})(${JSON.stringify({seed:initial,token:launch.token})})`,{window:win,setInterval(){}});const api=win.API;assert.equal(api.LMSGetValue('cmi.core.student_id'),'');assert.equal(api.LMSGetLastError(),'301');assert.equal(api.LMSInitialize(''),'true');assert.equal(api.LMSSetValue('cmi.core.student_id','other'),'false');assert.equal(api.LMSSetValue('cmi.core.lesson_status','bogus'),'false');assert.equal(api.LMSSetValue('cmi.core.lesson_location','slide-4'),'true');assert.equal(api.LMSSetValue('cmi.suspend_data','saved-state'),'true');assert.equal(api.LMSSetValue('cmi.core.exit','suspend'),'true');assert.equal(api.LMSSetValue('cmi.core.session_time','0000:01:02.50'),'true');assert.equal(api.LMSSetValue('cmi.core.lesson_status','completed'),'true');assert.equal(api.LMSSetValue('cmi.core.score.raw','90'),'true');assert.equal(api.LMSCommit(''),'true');data=sent[0].data;const saved=await call(m.runtime,'POST',{action:'save',token:launch.token,sequence:1,data},{user:'irish-user'});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses[0].status,'Completed');});
await check('nested SCORM helper frames share the root API without independent autosaves',async()=>{const sent=[];const outer={postMessage:v=>sent.push(v)};const root={parent:outer,addEventListener(){},frames:[]};let timers=0;const run=win=>vm.runInNewContext(`(${m.api.installScormRuntime.toString()})(${JSON.stringify({seed:m.api.initialData('learner','Learner','',''),token:'shared-launch'})})`,{window:win,setInterval(){timers++;}});run(root);assert.equal(root.API.LMSInitialize(''),'true');root.API.LMSSetValue('cmi.suspend_data','latest-progress');const child={parent:root,addEventListener(){},frames:[]};run(child);const grandchild={parent:child,addEventListener(){},frames:[]};run(grandchild);assert.equal(child.API,root.API);assert.equal(grandchild.API,root.API);assert.equal(grandchild.API.LMSGetValue('cmi.suspend_data'),'latest-progress');assert.equal(timers,1);grandchild.API.LMSSetValue('cmi.core.lesson_location','slide-8');grandchild.API.LMSCommit('');assert.equal(sent[0].data['cmi.core.lesson_location'],'slide-8');});
await check('exit handshake returns the latest shared resume state with an exact request acknowledgement',async()=>{
 const sent=[],listeners={};const outer={postMessage:v=>sent.push(v)};
 const win={parent:outer,addEventListener(name,fn){(listeners[name]??=[]).push(fn);},frames:[]};
 vm.runInNewContext(`(${m.api.installScormRuntime.toString()})(${JSON.stringify({seed:m.api.initialData('learner','Learner','',''),token:'flush-launch'})})`,{window:win,setInterval(){}});
 const flush=(source,token,id)=>listeners.message.forEach(fn=>fn({source,data:{type:'primark-scorm-flush',token,requestId:id}}));
 flush({},'flush-launch','spoof');flush(outer,'wrong-token','spoof');assert.equal(sent.length,0);
 flush(outer,'flush-launch','before-start');assert.equal(sent[0].type,'primark-scorm-flushed');assert.equal(sent[0].data,null);sent.length=0;
 win.API.LMSInitialize('');win.API.LMSSetValue('cmi.suspend_data','latest-rise-state');win.API.LMSSetValue('cmi.core.lesson_location','lesson-2');
 flush(outer,'flush-launch','exit-1');assert.equal(sent.length,1);assert.equal(sent[0].requestId,'exit-1');assert.equal(sent[0].data['cmi.suspend_data'],'latest-rise-state');assert.equal(sent[0].data['cmi.core.lesson_location'],'lesson-2');assert.equal(sent[0].data['cmi.core.exit'],'suspend');
});
await check('player readiness does not wait for slow course media',async()=>{
 const sent=[],listeners={};const win={parent:{postMessage:v=>sent.push(v)},addEventListener(){},frames:[]};
 const document={readyState:'loading',addEventListener(name,fn){listeners[name]=fn;}};
 vm.runInNewContext(`(${m.api.installScormRuntime.toString()})(${JSON.stringify({seed:{},token:'ready-launch'})})`,{window:win,document,setInterval(){}});
 assert.equal(sent.length,0);listeners.DOMContentLoaded();assert.equal(sent[0].type,'primark-scorm-ready');assert.equal(sent[0].token,'ready-launch');
});
await check('save ownership, idempotency and time are enforced',async()=>{assert.equal((await call(m.runtime,'POST',{action:'save',token:launch.token,sequence:2,data},{user:'uk-user'})).status,401);await call(m.runtime,'POST',{action:'save',token:launch.token,sequence:1,data},{user:'irish-user'});assert.equal((await first('SELECT total_centiseconds FROM scorm_progress WHERE learner_id=?','irish-user')).total_centiseconds,6250);});
await check('relaunch restores bookmark and suspend data and invalidates stale tab saves',async()=>{const r=await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'irish-user'});const seed=JSON.parse((await first('SELECT seed_json FROM scorm_launches WHERE token=?',r.data.token)).seed_json);assert.equal(seed['cmi.core.entry'],'resume');assert.equal(seed['cmi.core.lesson_location'],'slide-4');assert.equal(seed['cmi.suspend_data'],'saved-state');assert.equal(seed['cmi.core.total_time'],'0000:01:02.50');assert.equal((await call(m.runtime,'POST',{action:'save',token:launch.token,sequence:2,data},{user:'irish-user'})).status,409);});

const riseFixture=JSON.parse(readFileSync('tests/fixtures/rise-v3-progress.json','utf8'));
await check('Rise percentage matches a captured export and distinguishes course, lesson and quiz progress',async()=>{
 assert.equal(m.rise.riseProgressPercent(riseFixture.suspendData),riseFixture.sidebarPercent);
 assert.equal(m.rise.savedCourseProgress(JSON.stringify({'cmi.suspend_data':riseFixture.suspendData,'cmi.core.score.raw':'97'}),1),2);
 assert.equal(m.rise.savedCourseProgress(JSON.stringify({'cmi.core.score.raw':'97'}),1),null);
 assert.equal(m.rise.savedCourseProgress(JSON.stringify({'cmi.suspend_data':riseFixture.suspendData}),2),null);
 const raw=progress=>JSON.stringify({v:3,d:JSON.stringify({cpv:'fixture',progress})});
 assert.equal(m.rise.riseProgressPercent(raw({lessons:{'1':{p:86}}})),0);
 for(const percent of [0,2,98,100])assert.equal(m.rise.riseProgressPercent(raw({lessons:{},p:percent})),percent);
 for(const percent of [-1,101,'2',null,2.5])assert.equal(m.rise.riseProgressPercent(raw({lessons:{},p:percent})),null);
});
await check('unsupported and malformed suspend data cannot break course listing or expand without bounds',async()=>{
 for(const data of ['',null,'saved-state','{}','null',JSON.stringify({v:4,d:'{}'}),JSON.stringify({v:3,d:[]}),JSON.stringify({v:3,d:[999]}),JSON.stringify({v:3,d:[123,999]}),JSON.stringify({v:3,d:[123,1.5]}),JSON.stringify({v:3,d:[123,...Array.from({length:800},(_,i)=>256+i)]}),JSON.stringify({v:3,d:'x'.repeat(65537)})])assert.equal(m.rise.riseProgressPercent(data),null);
 assert.equal(m.rise.savedCourseProgress('{bad',1),null);
});
await check('saved Rise percentage is returned on the tile and survives launch without changing completion rules',async()=>{
 const r=await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'irish-user'});
 const resume={...data,'cmi.core.lesson_status':'incomplete','cmi.core.score.raw':'97','cmi.suspend_data':riseFixture.suspendData};
 const save=await call(m.runtime,'POST',{action:'save',token:r.data.token,sequence:1,data:resume},{user:'irish-user'});
 assert.equal(save.status,200);
 const tile=(await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses[0];
 assert.equal(tile.progressPercent,2);assert.equal(tile.status,'In progress');assert.equal(Number(tile.scos[0].score),97);
 const fresh=(await call(m.courses,'GET',undefined,{user:'uk-user'})).data.courses[0];
 assert.equal(fresh.progressPercent,null);assert.equal(fresh.status,'Not started');
 const next=await call(m.runtime,'POST',{action:'launch',courseId:course.id},{user:'irish-user'});
 const seed=JSON.parse((await first('SELECT seed_json FROM scorm_launches WHERE token=?',next.data.token)).seed_json);
 assert.equal(seed['cmi.suspend_data'],riseFixture.suspendData);assert.equal(seed['cmi.core.entry'],'resume');
 const completed=await call(m.runtime,'POST',{action:'save',token:next.data.token,sequence:1,data:{...resume,'cmi.core.lesson_status':'passed'}},{user:'irish-user'});
 assert.equal(completed.status,200);assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses[0].status,'Completed');
});
await check('admin preview never records learner progress',async()=>{const before=Number((await first('SELECT COUNT(*) n FROM scorm_progress')).n);const r=await call(m.runtime,'POST',{action:'launch',courseId:course.id,preview:true},{admin:true});assert.equal(r.status,200);assert.equal((await call(m.runtime,'POST',{action:'save',token:r.data.token,sequence:1,data},{admin:true})).status,200);assert.equal(Number((await first('SELECT COUNT(*) n FROM scorm_progress')).n),before);});
await check('concurrent edits rejected and pausing removes course without deleting records',async()=>{assert.equal((await call(m.admin,'POST',{...course,revision:0,audience:JSON.parse(course.audience_json),status:'draft'},{admin:true})).status,409);const r=await call(m.admin,'POST',{...course,audience:JSON.parse(course.audience_json),status:'draft'},{admin:true});assert.equal(r.status,200);assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.length,0);assert.equal(Number((await first('SELECT COUNT(*) n FROM scorm_progress')).n),1);});
await certificateChecks({m,check,query,first,call,learner,ireland,course,pack,context});
console.log(`${tests} course checks passed. All test data stayed in an in-memory PostgreSQL database.`);
rmSync(dir,{recursive:true,force:true});

await pg.close();
