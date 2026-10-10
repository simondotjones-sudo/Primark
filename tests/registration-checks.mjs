import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function registrationChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk,pg}) {
  const admin=await loginAdmin();
  const register=(email,site=store,extra={})=>invoke(m.prototype,'POST','/api/prototype',{action:'register',name:'Registration Test',email,workdayId:email.split('@')[0],country:site.country,storeId:site.id,registrationCode:'safety',password:'Case-Sensitive-Password',...extra});
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
  await check('Every imported country/language variant receives the correct subject cover',async()=>{
    const rows=(await query('SELECT * FROM courses WHERE source_course_id IS NOT NULL').all()).results;
    const expected={
      'safety-pass':['264','154','673','209','191','473','2006','168','192'],
      'dignity':['2487','2521','2520','2522','2470'],
      'security':['2525','2371'],
      'baler-safety':['1877'],
      'emergency-response':['819','236','1743','1755','1860','1765','235','1769'],
      'fire-safety':['169','208','1878','474','587','462'],
      'manual-handling':['2509'],
      'night-work':['2379','329'],
    };
    assert.equal(Object.values(expected).flat().length,rows.length);
    for(const [cover,ids] of Object.entries(expected))for(const id of ids){
      const course=rows.find(c=>c.source_course_id===id);
      assert(course,'Missing imported course '+id);
      assert.equal(m.covers.courseCoverKey(course),cover,course.title);
      // English titles provide a fallback for uncategorised pre-import uploads.
      assert.equal(m.covers.courseCoverKey({...course,category:''}),cover,course.title);
    }
    assert.equal(m.covers.courseCoverKey({title:'Unknown course'}),'safety-pass');
    assert.equal(m.covers.courseCoverKey({title:'Induction Positive Workplace: Preventing Harassment'}),'dignity');
    assert.equal(m.covers.courseCoverKey({title:'Fire warden',category:'Night Work'}),'night-work');
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
  await check('Two-step registration stores names and required Workday IDs without issuing a login code',async()=>{
    const body={action:'register',firstName:'  Zoë ',surname:' O’Neill  Smith ',email:'WORKDAY-USER@example.test',workdayId:' 00ab-123 ',storeId:store.id,registrationCode:' SAFETY ',password:'Workday-Password-123'};
    const created=await invoke(m.prototype,'POST','/api/prototype',body);assert.equal(created.status,200,await created.clone().text());
    assert.deepEqual(await created.json(),{ok:true,returnTo:'/?courses=1'});assert(cookieFrom(created,'primark_session'));
    const learner=await query('SELECT * FROM learners WHERE email=?','workday-user@example.test').first();
    assert.equal(learner.first_name,'Zoë');assert.equal(learner.surname,'O’Neill Smith');assert.equal(learner.name,'Zoë O’Neill Smith');assert.equal(learner.workday_id,'00AB-123');assert.equal(learner.country,store.country);
    const cookie='primark_session='+cookieFrom(created,'primark_session');
    const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();
    assert.equal(state.learner.id,learner.id);assert.equal(state.account.platformAdmin,false);assert.equal(state.account.managerStoreId,null);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{...body,email:'duplicate-id@example.test',workdayId:'00AB-123'})).status,409);
    assert.equal(await query('SELECT id FROM learners WHERE email=?','duplicate-id@example.test').first(),null);
    for(const extra of [{firstName:''},{surname:' '},{firstName:'x'.repeat(51)},{workdayId:'id@example.test'},{workdayId:'bad id'},{workdayId:123},{workdayId:'x'.repeat(51)},{registrationCode:'wrong'}])assert.equal((await invoke(m.prototype,'POST','/api/prototype',{...body,...extra,email:'invalid-details@example.test'})).status,400);
    for(const [i,workdayId] of [undefined,'','  '].entries()){
      const email=`no-workday-${i}@example.test`;
      assert.equal((await invoke(m.prototype,'POST','/api/prototype',{...body,email,workdayId})).status,400);
      assert.equal(await query('SELECT id FROM learners WHERE email=?',email).first(),null);
    }
  });
  await check('Email and Workday ID use the same password, session and learner record',async()=>{
    const id=(await query('SELECT id FROM learners WHERE email=?','workday-user@example.test').first()).id;
    for(const identifier of [' WORKDAY-USER@EXAMPLE.TEST ',' 00ab-123 ']){
      const signedIn=await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier,password:'Workday-Password-123'});
      assert.equal(signedIn.status,200);
      const cookie='primark_session='+cookieFrom(signedIn,'primark_session');
      assert.equal((await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json()).learner.id,id);
      assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier,password:'wrong-password'})).status,401);
    }
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier:'PR-UNKNOWN',password:'Workday-Password-123'})).status,401);
    const adminLogin=await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier:process.env.PRIMARK_ADMIN_EMAIL,password:process.env.PRIMARK_ADMIN_PASSWORD});
    assert.equal(adminLogin.status,200);assert(cookieFrom(adminLogin,'primark_admin'));
  });
  await check('Workday uniqueness is enforced by Postgres even if registration requests race',async()=>{
    await assert.rejects(query('UPDATE learners SET workday_id=? WHERE email=?','00AB-123','new-safety@example.test').run(),error=>error.code==='23505');
    assert.equal((await query('SELECT workday_id FROM learners WHERE email=?','new-safety@example.test').first()).workday_id,'NEW-SAFETY');
  });
  await check('Alternating email and Workday ID cannot bypass the existing ten-attempt limit',async()=>{
    assert.equal((await register('alias-limit@example.test',store,{workdayId:'RATE-LIMIT-ID'})).status,200);
    for(let i=0;i<10;i++)assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier:i%2?'alias-limit@example.test':'rate-limit-id',password:'wrong-password'})).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier:'alias-limit@example.test',password:'Case-Sensitive-Password'})).status,429);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier:'RATE-LIMIT-ID',password:'Case-Sensitive-Password'})).status,429);
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
    assert.equal((await germanResponse.clone().json()).returnTo,'/learn/legacy-154/');
    germanCookie='primark_session='+cookieFrom(germanResponse,'primark_session');
    germanId=(await query('SELECT id FROM learners WHERE email=?','german-fallback@example.test').first()).id;
    assert.equal((await query('SELECT course_id FROM learner_inductions WHERE learner_id=?',germanId).first()).course_id,'legacy-154');
    assert.deepEqual((await (await getCourses(germanCookie)).json()).courses.map(c=>c.id),['legacy-154']);
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-264'},germanCookie)).status,404);
    assert.deepEqual((await (await getCourses(irishCookie)).json()).courses.map(c=>c.id),['legacy-154']);
    assert.equal((await (await getCourses(irishCookie)).json()).courses[0].coverKey,'safety-pass');
  });
  await check('Country induction wins for new joiners; existing assignments and SCORM resume remain pinned',async()=>{
    await ready('legacy-264');
    const response=await register('german-local@example.test',german);assert.equal(response.status,200);assert.equal((await response.clone().json()).returnTo,'/learn/legacy-264/');const cookie='primark_session='+cookieFrom(response,'primark_session');
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
    const profile=(await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,managerCookie)).json()).account;assert.equal(profile.role,'Store Manager');assert(m.profile.profileViews(profile).some(v=>v.value==='access'));
  });
  await check('Managers can assign one or many courses to selected/all store users without cross-store access or duplicate records',async()=>{
    const body={courseIds:['legacy-2509'],userIds:[irishId]};
    assert.equal((await invoke(m.manager,'POST','/api/store',{...body,userIds:[irishId,germanId]},managerCookie)).status,403);
    assert.equal(await query('SELECT * FROM course_assignments WHERE learner_id=? AND course_id=?',irishId,'legacy-2509').first(),null);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-264'],userIds:[irishId]},managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-169'],allUsers:true},managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',body,managerCookie,{origin:'https://evil.invalid'})).status,403);
    let originalAssignment;
    for(let n=0;n<2;n++){
      const response=await invoke(m.manager,'POST','/api/store',body,managerCookie);assert.equal(response.status,200);
      const outcome=await response.json();assert.equal(outcome.added,n===0?1:0);assert.equal(outcome.alreadyAssigned,n===0?0:1);assert.equal(outcome.unavailable,0);
      const saved=await query('SELECT * FROM course_assignments WHERE learner_id=? AND course_id=?',irishId,'legacy-2509').first();
      if(n===0)originalAssignment=saved;else assert.deepEqual(saved,originalAssignment,'Repeat assignment keeps original date and actor');
    }
    const roster=await (await invoke(m.manager,'GET','/api/store',undefined,managerCookie)).json();assert(roster.assignments.some(a=>a.learner_id===irishId&&a.course_id==='legacy-2509'));
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments WHERE learner_id=? AND course_id=?',irishId,'legacy-2509').first()).n),1);
    assert((await (await getCourses(irishCookie)).json()).courses.some(c=>c.id==='legacy-2509'));
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-2509'},irishCookie)).status,200);
    const beforeAssignments=Number((await query('SELECT COUNT(*) AS n FROM course_assignments').first()).n);
    const bulk=await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-2509','legacy-154'],allUsers:true},managerCookie);assert.equal(bulk.status,200);const outcome=await bulk.json();
    assert(outcome.added>0);assert(outcome.alreadyAssigned>0);assert.equal(outcome.added+outcome.alreadyAssigned+outcome.unavailable,outcome.users*outcome.courses);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments').first()).n)-beforeAssignments,outcome.added);
    const expected=Number((await query('SELECT COUNT(*) AS n FROM learners l WHERE store_id=? AND NOT EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id) AND NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) AND NOT EXISTS(SELECT 1 FROM store_managers m WHERE m.learner_id=l.id)',store.id).first()).n);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments WHERE course_id=?','legacy-2509').first()).n),expected);
    assert.equal(await query('SELECT * FROM course_assignments WHERE learner_id=? AND course_id=?',germanId,'legacy-2509').first(),null);
  });
  await check('Manage Users assigns within the selected store for admins and rejects manager store spoofing',async()=>{
    assert.equal((await invoke(m.manager,'GET','/api/store?storeId='+uk.id,undefined,managerCookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{storeId:uk.id,courseIds:['legacy-154'],allUsers:true},managerCookie)).status,403);
    const global=await (await invoke(m.manager,'GET','/api/store',undefined,admin)).json();assert.equal(global.store,null);assert(global.people.some(p=>p.id===germanId));assert.equal(global.courses.length,0);
    const local=await (await invoke(m.manager,'GET','/api/store?storeId='+store.id,undefined,admin)).json();assert(local.people.every(p=>p.store_id===store.id));assert(local.courses.some(c=>c.id==='legacy-2509'));
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-154'],allUsers:true},admin)).status,400);
    assert.equal((await invoke(m.manager,'POST','/api/store',{storeId:store.id,courseIds:['legacy-154'],allUsers:true},admin,{origin:'https://evil.invalid'})).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{storeId:store.id,courseIds:['legacy-154'],userIds:[germanId]},admin)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{storeId:store.id,courseIds:['legacy-264'],userIds:[irishId]},admin)).status,403);
    const german=await query('SELECT store_id FROM learners WHERE id=?',germanId).first();
    const body={storeId:german.store_id,courseIds:['legacy-154'],userIds:[germanId]};
    for(let i=0;i<2;i++){const response=await invoke(m.manager,'POST','/api/store',body,admin);assert.equal(response.status,200);const outcome=await response.json();assert.equal(outcome.added,0);assert.equal(outcome.alreadyAssigned,1);assert.equal(outcome.unavailable,0);}
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM course_assignments WHERE learner_id=? AND course_id=?',germanId,'legacy-154').first()).n),1,'Pinned induction has one materialised assignment and does not need a duplicate manual assignment');
    const roster=await (await invoke(m.manager,'GET','/api/store?storeId='+german.store_id,undefined,admin)).json();assert(roster.assignments.some(a=>a.learner_id===germanId&&a.course_id==='legacy-154'));
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
