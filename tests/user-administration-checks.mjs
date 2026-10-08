import assert from 'node:assert/strict';
export async function userAdministrationChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk}){
  await query('DELETE FROM auth_limits').run();
  const bootstrap=await loginAdmin(),other=m.stores.find(s=>s.country===store.country&&s.id!==store.id),password='Management-test-password';
  const passwordHash=await m.learnerAuth.hashPassword(password),accounts={};
  async function seed(key,role,site=store){
    const id='management-'+key,email=id+'@example.test';
    await query('INSERT INTO learners(id,name,email,password_hash,code_hash,store_id,country,entered_at,induction_enrolled) VALUES(?,?,?,?,?,?,?,?,true)',id,id,email,passwordHash,await m.hash('LEGACY-TEST-CODE'),site?.id||'',site?.country||'',new Date().toISOString()).run();
    if(role==='platform')await query('INSERT INTO platform_admins(learner_id,assigned_by,updated_at) VALUES(?,?,?)',id,'test','2026-10-08').run();
    else if(role!=='learner'){
      await query('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES(?,?,?,?,?,?)',id,role==='manager'?'site':role,role==='organisation'?null:site.country,['manager','site'].includes(role)?site.id:null,'test','2026-10-08').run();
      if(role==='manager')await query('INSERT INTO store_managers(learner_id,store_id,assigned_by,updated_at) VALUES(?,?,?,?)',id,site.id,'test','2026-10-08').run();
    }
    await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(id),id,'2099-01-01').run();
    return accounts[key]={id,email,cookie:'primark_session='+id,site};
  }
  for(const [key,role,site] of [['store','manager',store],['store-peer','manager',store],['country','country',store],['country-peer','country',store],['org','organisation',store],['platform','platform',store],['learner','learner',store],['other','learner',other],['uk','learner',uk],['uk-admin','country',uk]])await seed(key,role,site);
  const list=(cookie,params='')=>invoke(m.users,'GET','/api/users?'+params,undefined,cookie);
  const read=async(cookie,params='')=>{const r=await list(cookie,params);assert.equal(r.status,200,await r.clone().text());return r.json();};
  const find=async(id,status='active')=>(await read(bootstrap,'search='+id+'&status='+status)).people.find(p=>p.id===id);
  const update=(cookie,person,extra={},headers={})=>invoke(m.users,'PATCH','/api/users',{id:person.id,revision:person.revision,action:'access',role:'learner',storeId:store.id,...extra},cookie,headers);
  const login=person=>invoke(m.prototype,'POST','/api/prototype',{action:'login',email:person.email,password});

  await check('Manage Users filters account types, countries, stores and status on the server with a 25-user page',async()=>{
    const all=await read(accounts.country.cookie,'search=management-');assert.equal(all.pageSize,25);assert(all.canEdit);assert(all.stores.every(s=>s.country===store.country));
    const learners=await read(accounts.country.cookie,'search=management-&type=learner');assert(learners.people.length);assert(learners.people.every(p=>!p.admin_only));
    const admins=await read(accounts.country.cookie,'search=management-&type=admin');assert(admins.people.length);assert(admins.people.every(p=>p.admin_only&&!p.platform_admin));
    assert(!all.people.some(p=>[accounts.org.id,accounts.platform.id,accounts.uk.id,accounts['uk-admin'].id].includes(p.id)));
    const site=await read(accounts.country.cookie,'search=management-&storeId='+other.id);assert.deepEqual(site.people.map(p=>p.id),[accounts.other.id]);
    const country=await read(accounts.org.cookie,'search=management-&country='+encodeURIComponent(uk.country));assert(country.people.length);assert(country.people.every(p=>p.country===uk.country));
    assert.equal((await list(accounts.country.cookie,'storeId='+uk.id)).status,403);assert.equal((await list(accounts.store.cookie,'storeId='+other.id)).status,403);
    assert.equal((await list(accounts.country.cookie,'country='+encodeURIComponent(uk.country))).status,403);
    assert.equal((await list(accounts.country.cookie,'type=invalid')).status,400);
    const local=await read(accounts.store.cookie,'search=management-');assert.equal(local.canEdit,false);assert(local.people.every(p=>!p.canEdit));assert(!local.people.find(p=>p.id===accounts.store.id).canArchive);
  });
  await check('Admins edit names and emails within scope with duplicate, stale and archived protections',async()=>{
    const person=await find(accounts.learner.id);
    assert((await read(accounts.store.cookie,'search='+person.id)).people[0].canEditDetails);
    for(const cookie of ['',accounts.learner.cookie])assert.equal((await update(cookie,person,{action:'details',name:'New name',email:person.email})).status,403);
    assert.equal((await update(accounts.store.cookie,await find(accounts.uk.id),{action:'details',name:'New name',email:'new@example.test'})).status,403);
    assert.equal((await update(accounts.country.cookie,await find(accounts.org.id),{action:'details',name:'New name',email:'new@example.test'})).status,403);
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'New name',email:person.email},{origin:'https://evil.invalid'})).status,403);
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'X',email:person.email})).status,400);
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'New name',email:'invalid'})).status,400);
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'New name',email:accounts.other.email})).status,409);
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'New name',email:process.env.PRIMARK_ADMIN_EMAIL})).status,409);
    const before=await query('SELECT * FROM learners WHERE id=?',person.id).first();
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'  New   name  ',email:person.email})).status,200);
    const current=await find(person.id);assert.equal(current.name,'New name');
    assert(await query('SELECT * FROM sessions WHERE learner_id=?',person.id).first(),'Name-only edit retains login');
    assert.equal((await update(accounts.store.cookie,person,{action:'details',name:'Stale name',email:person.email})).status,409);
    assert.equal((await update(accounts.country.cookie,current,{action:'details',name:'New name',email:'  Management-Learner-Corrected@Example.test  '})).status,200);
    const corrected=await query('SELECT * FROM learners WHERE id=?',person.id).first();assert.equal(corrected.email,'management-learner-corrected@example.test');assert.equal(corrected.password_hash,before.password_hash);assert.equal(corrected.store_id,before.store_id);
    assert.equal(await query('SELECT * FROM sessions WHERE learner_id=?',person.id).first(),null);
    accounts.learner.email=corrected.email;
    // Existing downstream checks search the original name.
    assert.equal((await update(bootstrap,await find(person.id),{action:'details',name:person.id,email:before.email})).status,200);accounts.learner.email=before.email;
    await query('DELETE FROM user_access_audit WHERE learner_id=?',person.id).run();
  });
  await check('Admins correct Employee IDs without losing history; duplicates, invalid IDs and stale edits fail',async()=>{
    const person=await find(accounts.learner.id);
    const change=(current,workdayId,cookie=accounts.store.cookie)=>update(cookie,current,{action:'details',name:current.name,email:current.email,workdayId});
    await query('UPDATE learners SET workday_id=? WHERE id=?','001234',accounts.other.id).run();
    assert.equal((await change(person,'001234')).status,409);
    for(const id of ['bad id','user@example.test','X'.repeat(51),42])assert.equal((await change(person,id)).status,400);
    assert.equal((await change(await find(accounts.uk.id),'UK-NEW')).status,403);
    const before=await query('SELECT * FROM learners WHERE id=?',person.id).first();
    const assignments=await query('SELECT * FROM course_assignments WHERE learner_id=?',person.id).all();
    const progress=await query('SELECT * FROM scorm_progress WHERE learner_id=?',person.id).all();
    const certificates=await query('SELECT * FROM certificates WHERE learner_id=?',person.id).all();
    assert.equal((await change(person,'  000abc  ')).status,200);
    let current=await find(person.id);assert.equal(current.workday_id,'000ABC');
    assert.equal((await change(person,'STALE')).status,409);
    const idLogin=await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'000abc',password});assert.equal(idLogin.status,200);
    await query('INSERT INTO password_resets(token_hash,account_type,account_id,credential_hash,expires_at) VALUES(?,?,?,?,?)','employee-id-reset','learner',person.id,'unused','2099-01-01').run();
    assert.equal((await change(current,'000xyz',accounts.country.cookie)).status,200);
    assert.equal(await query('SELECT * FROM sessions WHERE learner_id=?',person.id).first(),null);
    assert.equal(await query('SELECT * FROM password_resets WHERE account_id=?',person.id).first(),null);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'000abc',password})).status,401);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'000xyz',password})).status,200);
    assert.equal((await login(accounts.learner)).status,200);
    const after=await query('SELECT * FROM learners WHERE id=?',person.id).first();assert.equal(after.password_hash,before.password_hash);assert.equal(after.store_id,before.store_id);
    assert.deepEqual(await query('SELECT * FROM course_assignments WHERE learner_id=?',person.id).all(),assignments);
    assert.deepEqual(await query('SELECT * FROM scorm_progress WHERE learner_id=?',person.id).all(),progress);
    assert.deepEqual(await query('SELECT * FROM certificates WHERE learner_id=?',person.id).all(),certificates);
    current=await find(person.id);assert.equal((await change(current,'   ',accounts.org.cookie)).status,200);assert.equal((await find(person.id)).workday_id,null);
    assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:'000xyz',password})).status,401);
    const audit=await query("SELECT * FROM user_access_audit WHERE learner_id=? AND action='details' ORDER BY id",person.id).all();assert.equal(audit.results.length,3);assert.equal(audit.results[0].next_state.workday_id,'000ABC');
    await query('UPDATE learners SET workday_id=NULL WHERE id=?',accounts.other.id).run();
    await query('DELETE FROM user_access_audit WHERE learner_id=?',person.id).run();
    await query('DELETE FROM auth_limits').run();
  });
  await check('Admin password reset is scoped, honest about configuration/delivery, and throttled',async()=>{
    const person=await find(accounts.learner.id),keys=['POSTMARK_SERVER_TOKEN','POSTMARK_FROM_EMAIL','PRIMARK_APP_URL'],env=keys.map(k=>process.env[k]),fetch=globalThis.fetch;let mails=[];
    try{
      keys.forEach(k=>delete process.env[k]);
      assert.equal((await update(accounts.store.cookie,person,{action:'password-reset'})).status,503);
      assert.equal((await query('SELECT * FROM password_resets WHERE account_id=?',person.id).all()).results.length,0);
      process.env.POSTMARK_SERVER_TOKEN='fixture';process.env.POSTMARK_FROM_EMAIL='fixture@example.test';process.env.PRIMARK_APP_URL='https://test.invalid';
      globalThis.fetch=async(url,options)=>{mails.push(JSON.parse(options.body));return Response.json({ErrorCode:0});};
      assert.equal((await update(accounts.store.cookie,await find(accounts.uk.id),{action:'password-reset'})).status,403);assert.equal(mails.length,0);
      assert.equal((await update(accounts.store.cookie,person,{action:'password-reset',email:accounts.uk.email})).status,200);assert.equal(mails.length,1);assert.equal(mails[0].To,person.email);assert(mails[0].TextBody.includes('#token='));
      globalThis.fetch=async()=>Response.json({ErrorCode:1},{status:500});assert.equal((await update(accounts.store.cookie,person,{action:'password-reset'})).status,503);
      globalThis.fetch=async()=>Response.json({ErrorCode:0});
      await query('DELETE FROM auth_limits').run();
      for(let i=0;i<3;i++)assert.equal((await update(accounts.country.cookie,person,{action:'password-reset'})).status,200);
      assert.equal((await update(accounts.country.cookie,person,{action:'password-reset'})).status,429);
      const audit=await query("SELECT * FROM user_access_audit WHERE learner_id=? AND action='password-reset'",person.id).all();assert.equal(audit.results.length,4);assert(!JSON.stringify(audit).includes('#token='));
    }finally{globalThis.fetch=fetch;keys.forEach((k,i)=>{if(env[i]===undefined)delete process.env[k];else process.env[k]=env[i];});await query('DELETE FROM auth_limits').run();await query('DELETE FROM user_access_audit WHERE learner_id=?',person.id).run();}
  });
  await check('Country and organisation admins edit only permitted roles and locations; self-changes and CSRF are denied',async()=>{
    const learner=await find(accounts.learner.id);
    for(const cookie of ['',accounts.learner.cookie,accounts.store.cookie])assert.equal((await update(cookie,learner)).status,403);
    assert.equal((await update(accounts.country.cookie,learner,{}, {origin:'https://evil.invalid'})).status,403);
    for(const role of ['organisation','platform'])assert.equal((await update(accounts.country.cookie,learner,{role})).status,403);
    assert.equal((await update(accounts.org.cookie,learner,{role:'platform'})).status,403);
    for(const role of ['learner','site','manager','country'])assert.equal((await update(accounts.country.cookie,learner,{role,storeId:uk.id,country:uk.country})).status,403);
    for(const key of ['org','platform','uk','uk-admin'])assert.equal((await update(accounts.country.cookie,await find(accounts[key].id))).status,403);
    for(const key of ['store','country','org','platform'])for(const action of ['access','archive','restore','details','password-reset'])assert.equal((await update(accounts[key].cookie,await find(accounts[key].id),{action})).status,403);
    assert.equal((await update(accounts.country.cookie,learner,{role:'manager'})).status,200);
    assert.equal((await query('SELECT store_id FROM store_managers WHERE learner_id=?',learner.id).first()).store_id,store.id);
    assert.equal((await update(accounts.country.cookie,learner,{role:'learner'})).status,409,'An old editor must not overwrite a role change');
    assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,accounts.learner.cookie)).status,401,'Access editing signs out the old session');
    let current=await find(learner.id);assert(current.admin_only);
    assert.equal((await update(accounts.country.cookie,current,{role:'learner',storeId:other.id})).status,200);
    assert.equal(await query('SELECT learner_id FROM store_managers WHERE learner_id=?',learner.id).first(),null);
    current=await find(learner.id);assert(!current.admin_only);assert.equal(current.store_id,other.id);
    assert.equal((await update(accounts.org.cookie,current,{role:'country',country:uk.country})).status,200);
    current=await find(learner.id);assert.equal(current.reporting_country,uk.country);
    assert.equal((await update(accounts.country.cookie,current,{role:'learner'})).status,403);
    assert.equal((await update(bootstrap,current,{role:'learner',storeId:store.id})).status,200);
    const audit=await query('SELECT * FROM user_access_audit WHERE learner_id=? ORDER BY id',learner.id).all();assert.equal(audit.results.length,4);assert.equal(audit.results[0].actor_email,accounts.country.email);assert(!JSON.stringify(audit).includes('password_hash'));
  });
  await check('All admin levels archive only accounts in scope, including peer admins, and cannot archive themselves',async()=>{
    for(const key of ['org','platform','country','uk'])assert.equal((await update(accounts.store.cookie,await find(accounts[key].id),{action:'archive'})).status,403);
    const peer=await find(accounts['store-peer'].id);assert.equal((await update(accounts.store.cookie,peer,{action:'archive'})).status,200);
    assert(await query('SELECT learner_id FROM store_managers WHERE learner_id=?',peer.id).first());
    assert.equal((await invoke(m.users,'GET','/api/users',undefined,accounts['store-peer'].cookie)).status,403);
    const archived=await find(peer.id,'archived');assert(archived.archived_at);assert.equal(archived.canEdit,false);
    assert.equal((await update(accounts.country.cookie,archived,{role:'learner'})).status,400);
    assert.equal(archived.canEditDetails,false);
    assert.equal((await update(accounts.country.cookie,archived,{action:'details',name:'Changed',email:archived.email})).status,400);
    assert.equal((await update(accounts.country.cookie,archived,{action:'password-reset'})).status,400);
    assert.equal((await update(accounts.country.cookie,archived,{action:'restore'})).status,200);
    assert.equal((await invoke(m.users,'GET','/api/users',undefined,accounts['store-peer'].cookie)).status,403,'Restore must not revive old sessions');
    const fresh=await login(accounts['store-peer']);assert.equal(fresh.status,200);
    const cookie='primark_session='+cookieFrom(fresh,'primark_session');assert.equal((await list(cookie)).status,200);
    for(const [actor,target] of [['country','country-peer'],['org','uk-admin'],['platform','org']]){
      assert.equal((await update(accounts[actor].cookie,await find(accounts[target].id),{action:'archive'})).status,200);
      assert.equal((await list(accounts[target].cookie)).status,403);
      assert.equal((await update(bootstrap,await find(accounts[target].id,'archived'),{action:'restore'})).status,200);
      const response=await login(accounts[target]);assert.equal(response.status,200);accounts[target].cookie='primark_session='+cookieFrom(response,'primark_session');
    }
  });
  await check('Archive stops login, recovery, SCORM sessions and assignments while retaining reporting and certificates',async()=>{
    const person=accounts.learner;
    await query('INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at) VALUES(?,?,?,?)',person.id,'legacy-154','test','2026-10-08').run();
    const signed=await login(person);assert.equal(signed.status,200);person.cookie='primark_session='+cookieFrom(signed,'primark_session');
    const launched=await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-154'},person.cookie);assert.equal(launched.status,200,await launched.clone().text());const launch=await launched.json();
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'save',token:launch.token,sequence:1,data:{'cmi.core.lesson_status':'passed','cmi.core.score.raw':'97','cmi.core.session_time':'0000:00:01.00'}},person.cookie)).status,200);
    const progress=await query('SELECT * FROM scorm_progress WHERE learner_id=?',person.id).all(),certs=await query('SELECT * FROM certificates WHERE learner_id=?',person.id).all();assert(certs.results.length);
    await query('INSERT INTO password_resets(token_hash,account_type,account_id,credential_hash,expires_at) VALUES(?,?,?,?,?)','management-reset','learner',person.id,'unused','2099-01-01').run();
    assert.equal((await update(accounts.store.cookie,await find(person.id),{action:'archive'})).status,200);
    assert.equal((await login(person)).status,401);
    assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,person.cookie)).status,401);
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'save',token:launch.token,sequence:2,data:{}},person.cookie)).status,401);
    const content={GET:req=>m.content.GET(req,{params:Promise.resolve({token:launch.token,path:['index.html']})})};assert.equal((await invoke(content,'GET','/scorm-content/'+launch.token+'/index.html',undefined,person.cookie)).status,401);
    assert.equal((await query('SELECT * FROM password_resets WHERE account_id=?',person.id).all()).results.length,0);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-154'],userIds:[person.id]},accounts.store.cookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-154'],allUsers:true},accounts.store.cookie)).status,200);
    const roster=await (await invoke(m.manager,'GET','/api/store',undefined,accounts.store.cookie)).json();assert(!roster.people.some(p=>p.id===person.id));
    const report=await (await invoke(m.reporting,'GET','/api/reporting?view=activity&search='+person.email,undefined,accounts.country.cookie)).json();assert(report.employees.find(p=>p.id===person.id).archivedAt);assert(report.records.some(r=>r.status==='completed'));
    assert.deepEqual(await query('SELECT * FROM scorm_progress WHERE learner_id=?',person.id).all(),progress);assert.deepEqual(await query('SELECT * FROM certificates WHERE learner_id=?',person.id).all(),certs);
    const keys=['POSTMARK_SERVER_TOKEN','POSTMARK_FROM_EMAIL','PRIMARK_APP_URL'],env=keys.map(k=>process.env[k]),fetch=globalThis.fetch;let mails=0;
    try{process.env.POSTMARK_SERVER_TOKEN='fixture';process.env.POSTMARK_FROM_EMAIL='fixture@example.test';process.env.PRIMARK_APP_URL='https://test.invalid';globalThis.fetch=async()=>{mails++;return Response.json({ErrorCode:0});};assert.equal((await invoke(m.recovery,'POST','/api/password-recovery',{action:'request',email:person.email})).status,200);assert.equal(mails,0);}finally{globalThis.fetch=fetch;keys.forEach((k,i)=>{if(env[i]===undefined)delete process.env[k];else process.env[k]=env[i];});}
    const archived=await find(person.id,'archived');assert.equal((await update(accounts.country.cookie,archived,{action:'restore'})).status,200);
    assert.equal((await login(person)).status,200);assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,person.cookie)).status,401);
    assert.deepEqual(await query('SELECT * FROM certificates WHERE learner_id=?',person.id).all(),certs);
  });
  await check('Archived platform admins cannot use a retained session or regain access through a role edit',async()=>{
    const target=await find(accounts.platform.id);assert.equal((await update(bootstrap,target,{action:'archive'})).status,200);
    // Even if a stale/concurrent session exists, both authentication paths check archive status.
    await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(accounts.platform.id),accounts.platform.id,'2099-01-01').run();
    assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,accounts.platform.cookie)).status,403);
    assert.equal((await invoke(m.users,'GET','/api/users',undefined,accounts.platform.cookie)).status,403);
    assert.equal((await login(accounts.platform)).status,401);
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:target.id,scope:'platform'},bootstrap)).status,400);
    assert.equal((await update(bootstrap,await find(target.id,'archived'),{action:'restore'})).status,200);
    assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,accounts.platform.cookie)).status,403);
    assert.equal((await login(accounts.platform)).status,200);
  });
}
