import assert from 'node:assert/strict';

export async function adminOnlyChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk}) {
  await query('DELETE FROM auth_limits').run();
  const bootstrap=await loginAdmin(),password='Admin-only-fixture-password';
  const created={};let sequence=0;
  const create=(cookie,extra={})=>invoke(m.users,'POST','/api/users',{name:'Account fixture',email:`admin-only-${++sequence}@example.test`,password,accountType:'admin',role:'site',storeId:store.id,country:store.country,...extra},cookie);
  async function account(key,role,cookie=bootstrap,extra={}) {
    const email=`admin-only-${key}@example.test`;
    const response=await create(cookie,{email,role,...extra});assert.equal(response.status,201,await response.clone().text());
    const result=await response.json();
    const login=await invoke(m.prototype,'POST','/api/prototype',{action:'login',email,password});assert.equal(login.status,200);
    const session='primark_session='+cookieFrom(login,'primark_session');
    return created[key]={...result,cookie:session,email};
  }
  const list=cookie=>invoke(m.users,'GET','/api/users',undefined,cookie);
  const me=cookie=>invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie).then(r=>r.json());

  await check('Only authenticated admins can create accounts; cross-origin and invalid submissions create nothing',async()=>{
    assert.equal((await create('')).status,403);
    assert.equal((await list('')).status,403);
    const registered=await account('ordinary','site',bootstrap,{accountType:'learner',workdayId:'ACCOUNT-0001'});
    assert.equal((await create(registered.cookie)).status,403);
    assert.equal((await list(registered.cookie)).status,403);
    assert.equal((await me(registered.cookie)).account.adminOnly,false);
    assert.equal((await invoke(m.users,'POST','/api/users',{},bootstrap,{origin:'https://evil.invalid'})).status,403);
    for(const extra of [{accountType:'unknown'},{role:'unknown'},{email:'invalid'},{password:'short'},{storeId:'missing'},{role:'country',country:'Atlantis'}]){
      const before=(await query('SELECT COUNT(*) n FROM learners').first()).n;
      assert([400,403].includes((await create(bootstrap,extra)).status));
      assert.equal((await query('SELECT COUNT(*) n FROM learners').first()).n,before);
    }
    assert.equal((await create(bootstrap,{email:registered.email})).status,409);
    assert.equal((await create(bootstrap,{email:process.env.PRIMARK_ADMIN_EMAIL})).status,409);
    assert.equal((await create(bootstrap,{accountType:'learner',workdayId:'account-0001'})).status,409);
  });
  await check('Platform admins create every admin level atomically with attribution and hashed passwords',async()=>{
    for(const role of ['site','country','organisation','platform']){
      const person=await account(role,role);
      const state=await me(person.cookie);
      assert.equal(state.learner,null);assert.equal(state.account.adminOnly,true);
      assert(!m.profile.profileViews(state.account).some(v=>v.value==='learn'));
      assert(m.profile.profileViews(state.account).some(v=>v.value==='access'));
      const row=await query('SELECT * FROM learners WHERE id=?',person.id).first();
      assert.notEqual(row.password_hash,password);assert(await m.learnerAuth.verifyPassword(password,row.password_hash));
      const grant=await query(`SELECT assigned_by FROM ${role==='platform'?'platform_admins':'reporting_access'} WHERE learner_id=?`,person.id).first();
      assert.equal(grant.assigned_by,process.env.PRIMARK_ADMIN_EMAIL);
      assert.equal(await query('SELECT * FROM learner_inductions WHERE learner_id=?',person.id).first(),null);
    }
  });
  await check('Store admins create learners and peer admins only in their own store',async()=>{
    const {cookie}=created.site;
    const peer=await account('site-peer','site',cookie);
    assert.equal((await query('SELECT store_id FROM store_managers WHERE learner_id=?',peer.id).first()).store_id,store.id);
    assert.equal((await create(cookie,{accountType:'learner',role:'platform'})).status,201);
    for(const role of ['country','organisation','platform'])assert.equal((await create(cookie,{role})).status,403);
    for(const accountType of ['admin','learner'])assert.equal((await create(cookie,{storeId:uk.id,country:uk.country,accountType})).status,403);
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:peer.id,scope:'platform'},cookie)).status,403);
    const data=await (await list(cookie)).json();assert.deepEqual(data.roles,['site']);assert(data.stores.every(s=>s.id===store.id));
    assert(data.people.some(p=>p.id===peer.id));assert(!data.people.some(p=>p.id===created.country.id||p.id===created.platform.id));
  });
  await check('Country and organisation admins create only permitted roles and cannot discover higher-scope accounts',async()=>{
    await account('country-peer','country',created.country.cookie);
    const other=m.stores.find(s=>s.country===store.country&&s.id!==store.id);
    await account('country-site','site',created.country.cookie,{storeId:other.id});
    for(const role of ['organisation','platform'])assert.equal((await create(created.country.cookie,{role})).status,403);
    assert.equal((await create(created.country.cookie,{role:'country',country:uk.country})).status,403);
    assert.equal((await create(created.country.cookie,{accountType:'learner',storeId:uk.id})).status,403);
    const country=await (await list(created.country.cookie)).json();assert(country.people.some(p=>p.id===created['country-peer'].id));assert(!country.people.some(p=>p.id===created.organisation.id||p.id===created.platform.id));
    await account('organisation-peer','organisation',created.organisation.cookie);
    await account('organisation-uk','country',created.organisation.cookie,{country:uk.country});
    assert.equal((await create(created.organisation.cookie,{role:'platform'})).status,403);
    const org=await (await list(created.organisation.cookie)).json();assert(!org.people.some(p=>p.id===created.platform.id));
    assert.equal((await invoke(m.users,'GET','/api/users?page=-1',undefined,bootstrap)).status,400);
    const searched=await (await invoke(m.users,'GET','/api/users?search=ACCOUNT-0001',undefined,bootstrap)).json();assert.equal(searched.total,1);assert.equal(searched.people[0].id,created.ordinary.id);
  });
  await check('All admin levels are denied personal courses, certificates and original training while reporting works',async()=>{
    for(const role of ['site','country','organisation','platform']){
      const {cookie}=created[role];
      assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,cookie)).status,403);
      assert.equal((await invoke(m.certificates,'GET','/api/certificates',undefined,cookie)).status,403);
      for(const body of [{action:'view',key:'welcome'},{action:'submit',answers:m.lessons.questions.map(q=>q.correct)}])
        assert.equal((await invoke(m.prototype,'POST','/api/prototype',body,cookie)).status,403);
      assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-154'},cookie)).status,403);
      const report=await invoke(m.reporting,'GET','/api/reporting?view=export',undefined,cookie);assert.equal(report.status,200);
      const data=await report.json();assert(!data.employees.some(p=>Object.values(created).filter(p=>p.adminOnly).some(a=>a.id===p.id)));
    }
    assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,created.ordinary.cookie)).status,200);
  });
  await check('Admin-only accounts cannot receive selected or bulk assignments and cannot be selected as a direct course audience',async()=>{
    const {cookie}=created.site;
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-154'],userIds:[created.site.id]},cookie)).status,403);
    assert.equal((await invoke(m.manager,'POST','/api/store',{courseIds:['legacy-154'],allUsers:true},cookie)).status,200);
    assert.equal(await query('SELECT * FROM course_assignments WHERE learner_id=?',created.site.id).first(),null);
    const assignments=await (await invoke(m.manager,'GET','/api/store',undefined,cookie)).json();assert(assignments.assignments.some(a=>a.learner_id===created.ordinary.id&&a.course_id==='legacy-154'));assert(!assignments.assignments.some(a=>a.learner_id===created.site.id));
    const response=await invoke(m.courseAdmin,'POST','/api/admin/courses',{title:'Invalid admin audience',status:'draft',audience:{countries:[],sites:[],users:[created.site.id]}},bootstrap);
    assert.equal(response.status,400);
    const catalog=await (await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,bootstrap)).json();assert(!catalog.people.some(p=>p.id===created.site.id));
  });
  await check('Promotion blocks existing launches immediately and retains previous progress and certificates',async()=>{
    const {id,cookie}=created.ordinary;
    const launched=await invoke(m.scorm,'POST','/api/scorm',{action:'launch',courseId:'legacy-154'},cookie);assert.equal(launched.status,200);
    const {token}=await launched.json();
    const data={'cmi.core.lesson_status':'passed','cmi.core.score.raw':'95','cmi.core.session_time':'0000:00:01.00'};
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'save',token,sequence:1,data},cookie)).status,200);
    const before=await query('SELECT * FROM scorm_progress WHERE learner_id=?',id).all();
    const certs=await query('SELECT * FROM certificates WHERE learner_id=?',id).all();assert(certs.results.length);
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:id,scope:'site',siteId:store.id,managerStoreId:store.id},bootstrap)).status,200);
    assert.equal((await invoke(m.scorm,'POST','/api/scorm',{action:'save',token,sequence:2,data},cookie)).status,403);
    const content={GET:req=>m.content.GET(req,{params:Promise.resolve({token,path:['index.html']})})};
    assert.equal((await invoke(content,'GET','/scorm-content/'+token+'/index.html',undefined,cookie)).status,401);
    assert.deepEqual(await query('SELECT * FROM scorm_progress WHERE learner_id=?',id).all(),before);
    assert.deepEqual(await query('SELECT * FROM certificates WHERE learner_id=?',id).all(),certs);
    assert.equal((await me(cookie)).learner,null);
    const report=await (await invoke(m.reporting,'GET','/api/reporting?view=export',undefined,bootstrap)).json();assert(!report.employees.some(p=>p.id===id));assert(!report.records.some(p=>p.learnerId===id));
  });
  await check('Creation rights are revoked immediately with the existing session',async()=>{
    const {id,cookie}=created['site-peer'];
    assert.equal((await invoke(m.access,'POST','/api/admin/reporting-access',{learnerId:id,scope:'none',managerStoreId:null},bootstrap)).status,200);
    assert.equal((await create(cookie)).status,403);assert.equal((await list(cookie)).status,403);
  });
}
