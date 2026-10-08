import assert from 'node:assert/strict';
export async function reportingChecks({m,check,query,invoke,loginAdmin,store,uk}){
 const admin=await loginAdmin();
 const ie2=m.stores.find(s=>s.country==='Ireland'&&s.id!==store.id);
 const users=[['report-site',store],['report-country',store],['report-org',store],['report-other',ie2],['report-uk',uk]];
 const cookies={};
 for(const [id,site] of users){
  await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,induction_enrolled) VALUES(?,?,?,?,?,?,?,true)',id,id,id+'@example.test','unused',site.id,site.country,'2026-01-01T00:00:00.000Z').run();
  await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(id),id,'2099-01-01').run();cookies[id]='primark_session='+id;
 }
 for(const [id,scope,country,site] of [['report-site','site','Ireland',store.id],['report-country','country','Ireland',null],['report-org','organisation',null,null]]){
   const adminId=id+'-admin';
   await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)',adminId,adminId,adminId+'@example.test','unused',store.id,store.country,'2026-01-01').run();
   await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(adminId),adminId,'2099-01-01').run();cookies[id]='primark_session='+adminId;
   await query('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES(?,?,?,?,?,?)',adminId,scope,country,site,'test','2026-01-01').run();
 }
 const get=(cookie,params='')=>invoke(m.reporting,'GET','/api/reporting'+(params?'?'+params:''),undefined,cookie);
 const course=async(id,category,audience,extra={})=>{
  await query('INSERT INTO courses(id,title,status,audience_json,created_at,updated_at,category,catalogue_scope,available_countries_json,language_code,induction_role,validity_months) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,id,extra.status||'published',JSON.stringify(audience),'2026-01-01','2026-01-01',category,extra.scope||'unconfigured',JSON.stringify(extra.countries||[]),'en',extra.induction||'none',extra.validity??null).run();
  await query('INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)',id+'-package',id,'test.zip','ready',JSON.stringify((extra.scos||['one']).map(id=>({id,title:id,href:'index.html'}))),1,10,'2026-01-01').run();
  await query('UPDATE courses SET package_id=? WHERE id=?',id+'-package',id).run();
 };
 const audience=(countries=[],sites=[],users=[])=>({countries,sites,users});
 await course('report-fire','Fire Safety',audience(['Ireland']),{validity:12});
 await course('report-manual','Manual Handling',audience([],[store.id]),{scos:['one','two']});
 await course('report-uk-only','Fire Safety',audience(['United Kingdom']));
 await course('report-explicit','Night Work',audience());
 await course('report-induction-default','Induction',audience(),{induction:'default',scope:'global'});
 await course('report-induction-ie','Induction',audience(),{induction:'country',scope:'countries',countries:['Ireland']});
 await course('report-paused','Night Work',audience(['Ireland']),{status:'draft'});
 await query('INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at) VALUES(?,?,?,?)','report-site','report-explicit','test','2026-01-01').run();
 const progress=async(user,id,sco,status,completed=null)=>query('INSERT INTO scorm_progress(learner_id,package_id,sco_id,status,completed_at,updated_at,score) VALUES(?,?,?,?,?,?,?)',user,id+'-package',sco,status,completed,'2026-10-07','90').run();
 await progress('report-site','report-fire','one','completed','2024-01-31T10:00:00.000Z');
 await progress('report-country','report-fire','one','passed',new Date().toISOString());
 await progress('report-site','report-manual','one','completed','2026-01-01T10:00:00.000Z');
 await progress('report-site','report-manual','two','incomplete','2025-01-01T10:00:00.000Z');
 await progress('report-site','report-paused','one','completed',new Date().toISOString());
 await progress('report-uk','report-uk-only','one','incomplete');
 await check('Training reporting denies anonymous/learner requests and enforces site and country scope on every payload',async()=>{
  assert.equal((await get('')).status,403);assert.equal((await get(cookies['report-uk'])).status,403);
  for(const params of ['role=global','role=country&country=Ireland','role=site&site='+ie2.id,'role=site&site='+uk.id])assert.equal((await get(cookies['report-site'],params)).status,403);
  const report=await (await get(cookies['report-site'])).json();
  assert(report.employees.every(p=>p.storeId===store.id));assert(!JSON.stringify(report).includes('report-uk'));
  assert(report.records.every(r=>report.employees.some(p=>p.id===r.learnerId)));
  assert(report.courses.some(c=>c.id==='report-fire'));assert(!report.courses.some(c=>c.id==='report-uk-only'));
  for(const params of ['role=global','role=country&country=United+Kingdom','role=site&site='+uk.id])assert.equal((await get(cookies['report-country'],params)).status,403);
  assert.equal((await get(cookies['report-country'],'role=site&site='+ie2.id)).status,200);
  const org=await (await get(cookies['report-org'])).json();assert(org.employees.some(p=>p.id==='report-uk'));
 });
 await check('Matrix matches audience, explicit and country induction assignments without duplicate or unassigned completions',async()=>{
  const before=(await query('SELECT COUNT(*) n FROM learner_inductions').first()).n;
  const report=await (await get(cookies['report-site'])).json();
  const own=report.records.filter(r=>r.learnerId==='report-site');
  assert(own.some(r=>r.courseId==='report-explicit'));assert(own.some(r=>r.courseId==='report-induction-ie'));
  assert(!own.some(r=>r.courseId==='report-induction-default'));assert(!own.some(r=>r.courseId===m.reportTypes.ORIGINAL_INDUCTION));
  assert(!report.records.some(r=>r.learnerId==='report-country'&&r.courseId==='report-explicit'));
  assert.equal(new Set(report.records.map(r=>r.learnerId+'|'+r.courseId)).size,report.records.length);
  assert.equal((await query('SELECT COUNT(*) n FROM learner_inductions').first()).n,before,'Read-only reports must not create assignments');
 });
 await check('Matrix requires every current SCO to complete and keeps paused-course evidence without inventing expiry',async()=>{
  const report=await (await get(cookies['report-site'])).json();const find=(person,course)=>report.records.find(r=>r.learnerId===person&&r.courseId===course);
  assert.equal(find('report-site','report-fire').status,'expired');assert.equal(find('report-site','report-fire').expiresAt,'2025-01-31T10:00:00.000Z');
  assert.equal(find('report-country','report-fire').status,'completed');
  assert.equal(find('report-site','report-manual').status,'in-progress');assert.equal(find('report-site','report-manual').completedAt,null);
  assert.equal(find('report-site','report-explicit').status,'not-started');
  assert.equal(find('report-site','report-paused').status,'completed');assert.equal(find('report-site','report-paused').expiresAt,null);
  assert(report.courses.find(c=>c.id==='report-paused').paused);
  assert.equal(m.reportTypes.completionExpiry('2024-01-31T10:00:00.000Z',1),'2024-02-29T10:00:00.000Z');
  assert.equal(m.reportTypes.completionExpiry('2024-02-29T10:00:00.000Z',12),'2025-02-28T10:00:00.000Z');
  assert.equal(m.reportTypes.completionExpiry('2020-01-01',null),null);
 });
 await check('Optional course validity persists, validates and clears through the existing admin revision check',async()=>{
  const body={title:'Report expiry test',description:'',status:'draft',audience:audience()};
  const save=b=>invoke(m.courseAdmin,'POST','/api/admin/courses',b,admin);
  let response=await save({...body,validityMonths:12});assert.equal(response.status,200);let c=(await response.json()).course;assert.equal(c.validity_months,12);
  for(const validityMonths of [0,-1,1.5,121,'12'])assert.equal((await save({...body,id:c.id,revision:c.revision,validityMonths})).status,400);
  response=await save({...body,id:c.id,revision:c.revision});c=(await response.json()).course;assert.equal(c.validity_months,12);
  assert.equal((await save({...body,id:c.id,revision:c.revision-1,validityMonths:6})).status,409);
  response=await save({...body,id:c.id,revision:c.revision,validityMonths:null});assert.equal((await response.json()).course.validity_months,null);
 });
 await check('Removing report access immediately blocks the new reporting endpoint',async()=>{
  await query('DELETE FROM reporting_access WHERE learner_id=?','report-site-admin').run();assert.equal((await get(cookies['report-site'])).status,403);
 });
}
