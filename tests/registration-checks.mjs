import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function registrationChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk,pg}) {
  const admin=await loginAdmin();
  const register=(email,site=store,extra={})=>invoke(m.prototype,'POST','/api/prototype',{action:'register',name:'Registration Test',email,country:site.country,storeId:site.id,registrationCode:'safety',password:'Case-Sensitive-Password',...extra});
  const getCourses=cookie=>invoke(m.courses,'GET','/api/courses',undefined,cookie);
  const german=m.stores.find(s=>s.country==='Germany');
  let irishCookie,germanCookie,irishId,germanId;
  await check('All 34 spreadsheet placeholders are drafts, metadata is retained and seeding is idempotent',async()=>{
    const rows=(await query('SELECT * FROM courses WHERE source_course_id IS NOT NULL').all()).results;
    assert.equal(rows.length,34);assert(rows.every(c=>c.status==='draft'&&!c.package_id&&c.english_title&&c.category));
    assert.equal(rows.find(c=>c.source_course_id==='264').title,'Primark Mitarbeiterinduktion (DE)');
    assert.equal(rows.find(c=>c.source_course_id==='264').english_title,'Primark Employee Induction (DE)');
    assert.equal(rows.find(c=>c.source_course_id==='154').induction_role,'default');
    assert.equal(rows.find(c=>c.source_course_id==='209').induction_role,'none');
    assert.equal(rows.find(c=>c.source_course_id==='2525').legacy_assignment_count,230);
    await pg.exec(readFileSync('netlify/database/migrations/005_seed-primark-courses/migration.sql','utf8'));
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM courses WHERE source_course_id IS NOT NULL').first()).n),34);
  });
  await check('Registration requires safety, a password and a matching country/store; the shared code grants no admin rights',async()=>{
    for(const extra of [{registrationCode:''},{registrationCode:'wrong'},{registrationCode:'"safety"'},{password:'short'},{country:'Germany'}])assert.equal((await register('invalid@example.test',store,extra)).status,400);
    assert.equal(await query('SELECT id FROM learners WHERE email=?','invalid@example.test').first(),null);
    const created=await register('new-safety@example.test',store,{registrationCode:' SaFeTy ',scope:'organisation',managerStoreId:store.id});assert.equal(created.status,200);
    irishCookie='primark_session='+cookieFrom(created,'primark_session');
    const person=await query('SELECT * FROM learners WHERE email=?','new-safety@example.test').first();irishId=person.id;
    assert.equal(person.induction_enrolled,true);assert.match(person.password_hash,/^scrypt-v1:/);assert(!person.password_hash.includes('Case-Sensitive-Password'));
    const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,irishCookie)).json();assert.equal(state.account.platformAdmin,false);assert.equal(state.account.reportingAccess,null);assert.equal(state.account.managerStoreId,null);assert(!JSON.stringify(state).includes('password_hash'));
    assert.equal((await register('NEW-SAFETY@EXAMPLE.TEST')).status,409);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'new-safety@example.test',password:'case-sensitive-password'})).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'NEW-SAFETY@EXAMPLE.TEST',password:'Case-Sensitive-Password'})).status,200);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'new-safety@example.test',password:'safety'})).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'register',email:'cross@example.test'},'',{origin:'https://evil.invalid'})).status,403);
    const pending=await (await getCourses(irishCookie)).json();assert.equal(pending.courses.length,0);assert.equal(pending.inductionPending,true);
  });
  await check('Existing pass codes can set a password once while preserving identity and learning records',async()=>{
    await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)','legacy-account','Existing Learner','legacy-account@example.test',await m.hash('PR-OLD-CODE'),store.id,store.country,'2025-01-01').run();
    await query('INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?)','legacy-account','welcome','2025-01-01').run();
    const body={action:'set-password',email:'legacy-account@example.test',code:'pr-old-code',password:'New-Password-123'};
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{...body,code:'safety'})).status,401);
    const migrated=await invoke(m.prototype,'POST','/api/prototype',body);assert.equal(migrated.status,200);
    assert.equal((await query('SELECT id FROM learners WHERE email=?',body.email).first()).id,'legacy-account');
    assert(await query('SELECT module_key FROM module_views WHERE learner_id=?','legacy-account').first());
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',body)).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:body.email,password:body.password})).status,200);
  });
  async function ready(id) {
    await query("INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES(?,?,?,'ready',?,1,1,?)",'test-'+id,id,'fixture.zip',JSON.stringify([{id:'lesson',title:'Lesson',href:'index.html',mastery:'',launchData:''}]),'2026-10-07').run();
    await query("UPDATE courses SET package_id=?,status='published' WHERE id=?",'test-'+id,id).run();
  }
  await check('Published English fallback is assigned once and drafts never launch',async()=>{
    await ready('legacy-154');
    const germanResponse=await register('german-fallback@example.test',german);assert.equal(germanResponse.status,200);
    germanCookie='primark_session='+cookieFrom(germanResponse,'primark_session');
    germanId=(await query('SELECT id FROM learners WHERE email=?','german-fallback@example.test').first()).id;
    assert.equal((await query('SELECT course_id FROM learner_inductions WHERE learner_id=?',germanId).first()).course_id,'legacy-154');
    assert.deepEqual((await (await getCourses(germanCookie)).json()).courses.map(c=>c.id),['legacy-154']);
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-264'},germanCookie)).status,404);
    assert.deepEqual((await (await getCourses(irishCookie)).json()).courses.map(c=>c.id),['legacy-154']);
  });
  await check('Country induction wins for new joiners; existing assignments and SCORM resume remain pinned',async()=>{
    await ready('legacy-264');
    const response=await register('german-local@example.test',german);assert.equal(response.status,200);const cookie='primark_session='+cookieFrom(response,'primark_session');
    assert.deepEqual((await (await getCourses(cookie)).json()).courses.map(c=>c.id),['legacy-264']);
    assert.deepEqual((await (await getCourses(germanCookie)).json()).courses.map(c=>c.id),['legacy-154']);
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-154'},cookie)).status,403);
    const launch=await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-264'},cookie);assert.equal(launch.status,200);const {token}=await launch.json();
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'save',token,sequence:1,data:{'cmi.core.lesson_status':'incomplete','cmi.suspend_data':'country-resume','cmi.core.session_time':'0000:00:12.00'}},cookie)).status,200);
    const reopen=await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-264'},cookie);const next=await reopen.json();assert.equal(JSON.parse((await query('SELECT seed_json FROM scorm_launches WHERE token=?',next.token).first()).seed_json)['cmi.suspend_data'],'country-resume');
  });
  await check('Admins can edit catalogue metadata and publish library-only courses without assigning everyone',async()=>{
    const existing=await query('SELECT * FROM courses WHERE id=?','legacy-2509').first();
    const body={id:existing.id,revision:existing.revision,title:existing.title,description:'',status:'draft',audience:JSON.parse(existing.audience_json),englishTitle:existing.english_title,category:'Manual Handling',languageCode:'en',catalogueScope:'countries',availableCountries:['Ireland'],inductionRole:'none'};
    assert.equal((await invoke(m.courseAdmin,'POST','/api/admin/courses',{...body,availableCountries:['Atlantis']},admin)).status,400);
    assert.equal((await invoke(m.courseAdmin,'POST','/api/admin/courses',{...body,inductionRole:'default'},admin)).status,400);
    assert.equal((await invoke(m.courseAdmin,'POST','/api/admin/courses',body,admin)).status,200);
    await ready('legacy-2509');await query("UPDATE courses SET status='draft' WHERE id='legacy-2509'").run();
    const saved=await query('SELECT * FROM courses WHERE id=?',body.id).first();
    assert.equal((await invoke(m.courseAdmin,'POST','/api/admin/courses',{...body,revision:saved.revision,status:'published'},admin)).status,200);
    assert(!(await (await getCourses(irishCookie)).json()).courses.some(c=>c.id==='legacy-2509'));
  });
  let managerCookie;
  await check('Only explicitly granted Store Managers can see their store and published country library',async()=>{
    const created=await register('assigned-manager@example.test');assert.equal(created.status,200);managerCookie='primark_session='+cookieFrom(created,'primark_session');
    const person=await query('SELECT id FROM learners WHERE email=?','assigned-manager@example.test').first();
    assert.equal((await invoke(m.manager,'GET','/api/store',undefined,managerCookie)).status,403);
    const grant={learnerId:person.id,scope:'site',siteId:store.id,managerStoreId:store.id};
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',grant,managerCookie)).status,403);
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',grant,admin)).status,200);
    const result=await invoke(m.manager,'GET','/api/store?site='+uk.id,undefined,managerCookie);assert.equal(result.status,200);const data=await result.json();
    assert(data.people.every(p=>p.store_id===store.id));assert(data.courses.some(c=>c.id==='legacy-2509'));assert(!data.courses.some(c=>c.id==='legacy-264'||c.id==='legacy-208'));
    assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,managerCookie)).status,403);
    const profile=(await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,managerCookie)).json()).account;assert.equal(profile.role,'Store Manager');assert(m.profile.profileViews(profile).some(v=>v.value==='store'));
  });
  await check('Managers can assign one or many courses to selected/all store users without cross-store access or duplicate records',async()=>{
    const body={courseIds:['legacy-2509'],userIds:[irishId]};
    assert.equal((await invoke(m.manager,'POST','/api/store',{...body,userIds:[irishId,germanId]},managerCookie)).status,403);
    assert.equal(await query('SELECT * FROM course_assignments WHERE learner_id=?',irishId).first(),null);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-264'],userIds:[irishId]},managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-169'],allUsers:true},managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',body,managerCookie,{origin:'https://evil.invalid'})).status,403);
    for(let n=0;n<2;n++)assert.equal((await invoke(m.manager,'POST','/api/store',body,managerCookie)).status,200);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments WHERE learner_id=? AND course_id=?',irishId,'legacy-2509').first()).n),1);
    assert((await (await getCourses(irishCookie)).json()).courses.some(c=>c.id==='legacy-2509'));
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-2509'},irishCookie)).status,200);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-2509','legacy-154'],allUsers:true},managerCookie)).status,200);
    const expected=Number((await query('SELECT COUNT(*) AS n FROM learners WHERE store_id=?',store.id).first()).n);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments WHERE course_id=?','legacy-2509').first()).n),expected);
    assert.equal(await query('SELECT * FROM course_assignments WHERE learner_id=?',germanId).first(),null);
  });
  await check('Revoking Store Manager access takes effect on the existing session immediately',async()=>{
    const person=await query('SELECT id FROM learners WHERE email=?','assigned-manager@example.test').first();
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:person.id,scope:'site',siteId:store.id,managerStoreId:null},admin)).status,200);
    assert.equal((await invoke(m.manager,'GET','/api/store',undefined,managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-2509'],allUsers:true},managerCookie)).status,403);
  });
  await check('Password login throttles repeated failures and unknown accounts never authenticate',async()=>{
    for(let i=0;i<10;i++)assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'unknown@example.test',password:'unknown-password'})).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'unknown@example.test',password:'unknown-password'})).status,429);
  });
}
