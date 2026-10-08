import assert from 'node:assert/strict';

export async function platformAdminChecks({m,check,query,invoke,loginAdmin,cookieFrom,store}) {
  await query('DELETE FROM auth_limits').run();
  const bootstrap = await loginAdmin();
  const endpoint = '/api/admin/reporting-access';
  const email = 'platform-admin-fixture@example.test', password = 'Existing-password-123';
  const role = (learnerId,scope,cookie=bootstrap,extra={},headers={}) => invoke(m.access,'POST',endpoint,{learnerId,scope,managerStoreId:null,...extra},cookie,headers);
  const me = async cookie => (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();
  const login = (identifier=email,secret=password) => invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier,password:secret,returnTo:'/admin/reporting-access'});
  let id, cookie, original;

  await check('Registering an admin-named account or posting a role never grants platform access',async()=>{
    const res = await invoke(m.prototype,'POST','/api/prototype',{action:'register',firstName:'Platform',surname:'Admin',email,workdayId:'PA-001',storeId:store.id,registrationCode:'safety',password,platformAdmin:true,scope:'platform'});
    assert.equal(res.status,200,await res.clone().text());
    cookie = 'primark_session='+cookieFrom(res,'primark_session');
    const state = await me(cookie); id = state.learner.id;
    assert.equal(state.platformAdmin,false);
    assert.equal((await role(id,'platform',cookie)).status,403);
    assert.equal((await role(id,'platform','')).status,403);
    await query('INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?)',id,'welcome','2026-10-08').run();
    original = await query('SELECT * FROM learners WHERE id=?',id).first();
  });

  await check('Only an existing platform admin can promote an account; promotion preserves identity and learning',async()=>{
    assert.equal((await role(id,'organisation')).status,200);
    assert.equal((await role(id,'platform',cookie)).status,403);
    assert.equal((await role(id,'platform',bootstrap,{}, {origin:'https://evil.invalid'})).status,403);
    assert.equal((await role('missing-admin','platform')).status,400);
    assert.equal((await role(id,'platform')).status,200);
    const state = await me(cookie);
    assert.equal(state.platformAdmin,true); assert.equal(state.account.platformAdmin,true);
    assert.equal(state.account.role,'Platform admin'); assert.equal(state.account.site,'All Primark');
    assert.equal(state.account.email,email); assert.equal(state.learner,null); assert.equal(state.account.adminOnly,true); assert.deepEqual(state.viewed,[]);
    assert(await query('SELECT * FROM module_views WHERE learner_id=?',id).first());
    assert.deepEqual(await query('SELECT * FROM learners WHERE id=?',id).first(),original);
    assert.equal(await query('SELECT * FROM reporting_access WHERE learner_id=?',id).first(),null);
    const grant = await query('SELECT * FROM platform_admins WHERE learner_id=?',id).first();
    assert.equal(grant.assigned_by,process.env.PRIMARK_ADMIN_EMAIL);
    const list = await (await invoke(m.access,'GET',endpoint,undefined,bootstrap)).json();
    assert.equal(list.people.find(p=>p.id===id).platform_admin,true);
    assert.equal((await me(bootstrap)).platformAdmin,true);
  });

  await check('A granted admin uses the normal login and can access courses, users, organisation, reporting and photos',async()=>{
    const res = await login(); assert.equal(res.status,200);
    assert.equal((await res.json()).returnTo,'/admin/reporting-access');
    cookie = 'primark_session='+cookieFrom(res,'primark_session');
    for (const [route,url] of [[m.courseAdmin,'/api/admin/courses'],[m.access,endpoint],[m.organisation,'/api/admin/organisation'],[m.prototype,'/api/prototype?view=dashboard&year=all'],[m.shots,'/api/shot-list']]) {
      const result = await invoke(route,'GET',url,undefined,cookie);
      assert.equal(result.status,200,url+': '+await result.clone().text());
    }
    assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,cookie)).status,403);
    assert.equal((await invoke(m.shots,'POST','/api/shot-list',{module:1,slide:2,status:'complete',note:''},cookie)).status,200);
    assert.equal((await query('SELECT updated_by_admin FROM shot_states WHERE module_number=1 AND slide_number=2').first()).updated_by_admin,email);
    const other = await query('SELECT id FROM learners WHERE email=?','new@example.test').first();
    assert.equal((await role(other.id,'platform',cookie)).status,200);
    assert.equal((await query('SELECT assigned_by FROM platform_admins WHERE learner_id=?',other.id).first()).assigned_by,email);
    assert.equal((await role(other.id,'none',cookie)).status,200);
    assert.equal((await login('pa-001')).status,200);
    const unsafe = await invoke(m.prototype,'POST','/api/prototype',{action:'login',email,password,returnTo:'//evil.invalid'});
    assert.equal((await unsafe.json()).returnTo,'/admin/courses');
  });

  await check('Invalid role changes and self-removal leave platform access intact',async()=>{
    assert.equal((await role(id,'none',cookie)).status,400);
    assert.equal((await role(id,'country',bootstrap,{country:'Atlantis'})).status,400);
    assert.equal((await role(id,'unknown')).status,400);
    assert.equal((await me(cookie)).platformAdmin,true);
  });

  await check('Removing platform status revokes platform routes while retaining country-scoped store setup',async()=>{
    assert.equal((await role(id,'country',bootstrap,{country:store.country})).status,200);
    const state = await me(cookie);
    assert.equal(state.platformAdmin,false); assert.equal(state.account.platformAdmin,false);
    assert.equal(state.account.role,'Country reporting admin'); assert.equal(state.reportingAccess.country,store.country);
    for (const [route,url] of [[m.courseAdmin,'/api/admin/courses'],[m.access,endpoint],[m.shots,'/api/shot-list']])
      assert.equal((await invoke(route,'GET',url,undefined,cookie)).status,403,url);
    const directory=await invoke(m.organisation,'GET','/api/admin/organisation',undefined,cookie);assert.equal(directory.status,200);assert((await directory.json()).stores.every(s=>s.country===store.country));
    assert.equal((await role(id,'platform',cookie)).status,403);
    assert.equal((await invoke(m.shots,'POST','/api/shot-list',{module:1,slide:2,status:'todo'},cookie)).status,403);
    assert.equal((await invoke(m.packages,'POST','/api/admin/packages',{},cookie)).status,403);
    assert.equal((await invoke(m.prototype,'GET','/api/prototype?view=dashboard&year=all',undefined,cookie)).status,200);
    assert.equal((await role(id,'none')).status,200);
    assert.equal((await me(cookie)).reportingAccess,null);
    const retained=await query('SELECT * FROM learners WHERE id=?',id).first();
    assert(retained.last_login_at>=original.last_login_at);
    assert.deepEqual({...retained,last_login_at:original.last_login_at},original);
  });

  await check('Granted admin sign-out revokes the registered session and expired sessions cannot use a grant',async()=>{
    assert.equal((await role(id,'platform')).status,200);
    const res = await invoke(m.session,'POST','/api/admin/session',{action:'logout'},cookie);
    assert.equal(res.status,200); assert(res.headers.get('set-cookie').includes('primark_session=;'));
    assert.equal((await me(cookie)).platformAdmin,false); assert.equal((await me(cookie)).learner,null);
    const logged = await login(); cookie = 'primark_session='+cookieFrom(logged,'primark_session');
    await query('UPDATE sessions SET expires_at=? WHERE token_hash=?','2000-01-01',await m.hash(cookieFrom(logged,'primark_session'))).run();
    assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,cookie)).status,403);
  });

  await check('Granted admin password recovery keeps the grant and learning records while invalidating old sessions',async()=>{
    const savedFetch = globalThis.fetch;
    const keys = ['POSTMARK_SERVER_TOKEN','POSTMARK_FROM_EMAIL','PRIMARK_APP_URL'];
    const savedEnv = keys.map(k=>process.env[k]); let mail;
    try {
      await query('DELETE FROM auth_limits').run();
      process.env.POSTMARK_SERVER_TOKEN='fixture';process.env.POSTMARK_FROM_EMAIL='sender@example.test';process.env.PRIMARK_APP_URL='https://test.invalid';
      globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.postmarkapp.com/email');mail=JSON.parse(options.body);return Response.json({ErrorCode:0});};
      const logged = await login(); cookie = 'primark_session='+cookieFrom(logged,'primark_session');
      const requested = await invoke(m.recovery,'POST','/api/password-recovery',{action:'request',email});
      assert.equal(requested.status,200,await requested.clone().text());assert.equal(mail.To,email);assert(mail.TextBody.includes('Platform admin:'));
      const token = mail.TextBody.match(/#token=([a-f0-9]{64})/)[1];
      const reset = await invoke(m.recovery,'POST','/api/password-recovery',{action:'reset',token,password:'Replacement-password-123'});
      assert.equal(reset.status,200,await reset.clone().text());
      assert.equal((await me(cookie)).platformAdmin,false);assert.equal((await login()).status,401);
      const replacement = await login(email,'Replacement-password-123');assert.equal(replacement.status,200);
      assert.equal((await me('primark_session='+cookieFrom(replacement,'primark_session'))).platformAdmin,true);
      assert(await query('SELECT * FROM platform_admins WHERE learner_id=?',id).first());
      assert(await query('SELECT * FROM module_views WHERE learner_id=?',id).first());
      assert.equal((await role(id,'none')).status,200);
    } finally {
      globalThis.fetch=savedFetch;
      keys.forEach((k,i)=>{if(savedEnv[i]===undefined)delete process.env[k];else process.env[k]=savedEnv[i];});
    }
  });
}
