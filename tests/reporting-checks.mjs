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
 const get=(cookie,params='')=>invoke(m.reporting,'GET','/api/reporting?view=export'+(params?'&'+params:''),undefined,cookie);
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
 // Search and summaries use the same completion rules as the detailed report.
 const read=async(cookie,params='')=>{const response=await invoke(m.reporting,'GET','/api/reporting?'+params,undefined,cookie);assert.equal(response.status,200,await response.clone().text());return response.json();};
 await check('Overview aggregates full-scope totals without returning people or training rows; search cannot change totals',async()=>{
   for(const filter of ['', 'category=Fire+Safety', 'course=report-manual', 'category=Induction']){
     const summary=await read(cookies['report-org'],filter),detail=await read(cookies['report-org'],'view=export&'+filter);
     assert(!('employees' in summary));assert(!('records' in summary));
     assert.equal(summary.metrics.employees,new Set(detail.records.map(r=>r.learnerId)).size);
     assert.equal(summary.metrics.records,detail.records.length);
     assert.equal(summary.metrics.inProgress,detail.records.filter(r=>r.status==='in-progress').length);
     assert.equal(summary.metrics.expired,detail.records.filter(r=>r.status==='expired').length);
     assert.equal(summary.completions.reduce((n,r)=>n+r.count,0),detail.records.filter(r=>r.completedAt).length);
     assert.equal(summary.groups.reduce((n,r)=>n+r.total,0),detail.records.length);
     assert.equal(summary.legacy.reduce((n,r)=>n+r.count,0),detail.legacy.length);
     assert.deepEqual(summary.courses,detail.courses);
     assert.deepEqual((await read(cookies['report-org'],filter+'&search=nonexistent-user')).metrics,summary.metrics);
   }
   assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=matrix',undefined,cookies['report-org'])).status,400);
   assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=matrix&role=site&site='+store.id,undefined,cookies['report-org'])).status,200);
 });
 await query('UPDATE learners SET workday_id=? WHERE id=?','WD-REPORT-001','report-site').run();
 await check('User activity starts empty, searches names/email/Workday ID literally and enforces every scope',async()=>{
   const blank=await read(cookies['report-site'],'view=activity&search=+++');assert.equal(blank.records.length,0);assert.equal(blank.employees.length,0);assert.equal(blank.hasMore,false);
   for(const search of ['REPORT-SITE','report-site@example.test','wd-report-001']){
     const found=await read(cookies['report-site'],'view=activity&search='+encodeURIComponent(search));assert(found.records.length);assert.equal(found.employees.length,1);assert.equal(found.employees[0].id,'report-site');assert.equal(found.employees[0].workdayId,'WD-REPORT-001');
     assert(!('legacy' in found));assert(!JSON.stringify(found).includes('code_hash'));assert(!JSON.stringify(found).includes('data_json'));
   }
   for(const search of ['report-uk','report-other','report-site-admin',"%' OR 1=1 --",'%','_'])assert.equal((await read(cookies['report-site'],'view=activity&search='+encodeURIComponent(search))).records.length,0);
   assert.equal((await read(cookies['report-country'],'view=activity&search=report-uk')).records.length,0);
   assert((await read(cookies['report-org'],'view=activity&search=report-uk')).records.length>0);
   for(const cookie of ['', 'primark_session=report-uk'])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=activity&search=report',undefined,cookie)).status,403);
   for(const view of ['overview','activity','matrix','export'])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view='+view+'&role=site&site='+uk.id,undefined,cookies['report-site'])).status,403);
   for(const params of ['page=0','page=-1','page=1.5','page=NaN','page=1000001','search='+('a'.repeat(201)),'view=invalid'])assert.equal((await invoke(m.reporting,'GET','/api/reporting?'+(params.startsWith('view=')?params:'view=activity&'+params),undefined,cookies['report-site'])).status,400);
 });
 await check('Pinned inductions, stale SCOs, missing dates and issued certificate expiry survive the query change',async()=>{
   await course('report-pinned','Induction',audience(),{induction:'country',status:'draft'});
   await query('INSERT INTO learner_inductions(learner_id,course_id,assigned_at) VALUES(?,?,?)','report-site','report-pinned','2026-01-01').run();
   await course('report-no-date','Fire Safety',audience(['Ireland']));
   await progress('report-site','report-no-date','one','passed');
   await progress('report-site','report-no-date','removed-sco','passed','2026-01-01T10:00:00.000Z');
   await course('report-cert','Fire Safety',audience(),{validity:1,status:'draft'});
   await query('INSERT INTO certificates(token,learner_id,course_id,package_id,course_title,learner_name,store_id,country,completed_at,expires_at,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)','report-cert-token','report-site','report-cert','report-cert-package','Snapshot title','report-site',store.id,store.country,'2024-01-31T10:00:00.000Z','2090-01-31T10:00:00.000Z','2024-01-31T10:00:00.000Z').run();
   const found=await read(cookies['report-site'],'view=activity&search=WD-REPORT-001');
   const record=id=>found.records.find(r=>r.courseId===id);
   assert(record('report-pinned'));assert(!record('report-induction-ie'));
   assert.equal(record('report-no-date').status,'completed');assert.equal(record('report-no-date').completedAt,null);
   assert.equal(record('report-cert').status,'completed');assert.equal(record('report-cert').expiresAt,'2090-01-31T10:00:00.000Z');
   const category=await read(cookies['report-site'],'view=activity&search=WD-REPORT-001&category=Fire+Safety');assert(category.courses.every(c=>c.category==='Fire Safety'));
   const single=await read(cookies['report-site'],'view=activity&search=WD-REPORT-001&course=report-cert');assert.equal(single.records.length,1);
 });
 await check('Broad activity searches paginate 25 records without overlap and summary payload stays bounded',async()=>{
   await query("INSERT INTO learners(id,name,email,workday_id,code_hash,store_id,country,entered_at,induction_enrolled) SELECT 'page-'||i,'Same name','page-'||i||'@example.test','PAGE-'||i,'unused',?,?,?,true FROM generate_series(1,1000) i",store.id,store.country,'2026-01-01').run();
   const params='search=PAGE-&course=report-fire';
   const summary=await read(cookies['report-site'],'course=report-fire');
   assert(summary.metrics.employees>=1000);assert(JSON.stringify(summary).length<25000);
   const ids=new Set();let page=1,hasMore=true;
   while(hasMore){const data=await read(cookies['report-site'],'view=activity&'+params+'&page='+page);assert(data.records.length<=25);assert.equal(data.page,page);assert.equal(data.pageSize,25);
     for(const r of data.records){const id=r.learnerId+'|'+r.courseId;assert(!ids.has(id),'Pages must not overlap');ids.add(id);}hasMore=data.hasMore;page++;assert(page<=41);
   }
   assert.equal(ids.size,1000);
   const exported=await read(cookies['report-site'],'view=export&'+params);assert.equal(exported.records.length,ids.size);
   const beyond=await read(cookies['report-site'],'view=activity&'+params+'&page=999');assert.equal(beyond.records.length,0);assert.equal(beyond.hasMore,false);
   console.log('INFO 1,000 matched training records: '+JSON.stringify(summary).length+' byte overview; 25 records per activity page.');
   await query("DELETE FROM learners WHERE id LIKE 'page-%'").run();
 });
 await check('Removing report access immediately blocks the new reporting endpoint',async()=>{
  await query('DELETE FROM reporting_access WHERE learner_id=?','report-site-admin').run();for(const view of ['overview','activity','matrix','export'])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view='+view+'&search=report',undefined,cookies['report-site'])).status,403);
 });
}
