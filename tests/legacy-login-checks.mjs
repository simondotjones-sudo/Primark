import assert from 'node:assert/strict';

export async function legacyLoginChecks({m,check,query,invoke,loginAdmin,cookieFrom,store}) {
  const password='Historic-password-123';
  const hash=await m.learnerAuth.hashPassword(password);
  const create=async(id,email=null,code=id.toUpperCase())=>{
    await query('INSERT INTO learners(id,name,email,code_hash,password_hash,workday_id,legacy_access_code,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,'Historic Test',email,await m.hash('HASH-'+id.toUpperCase()),hash,'WD-'+id.toUpperCase(),code,store.id,store.country,'2025-01-01').run();
  };
  const login=(identifier,extra={})=>invoke(m.prototype,'POST','/api/prototype',{action:'login',identifier,password,...extra});
  const cookie=r=>'primark_session='+cookieFrom(r,'primark_session');
  const me=c=>invoke(m.prototype,'GET','/api/prototype?view=me',undefined,c).then(r=>r.json());
  const complete=(c,email,headers={})=>invoke(m.prototype,'POST','/api/prototype',{action:'complete-email',email},c,headers);
  const admin=await loginAdmin();
  let pending,completed;
  await check('Legacy code + password and Workday + password require email; pending sessions cannot access learning, reports or platform admin',async()=>{
    await create('historic-email');
    await query('INSERT INTO platform_admins(learner_id,assigned_by,updated_at) VALUES(?,?,?)','historic-email','fixture','2026-01-01').run();
    await query('INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?)','historic-email','welcome','2025-01-01').run();
    for(const id of [' historic-email ','wd-historic-email','HASH-HISTORIC-EMAIL']) {
      const response=await login(id);assert.equal(response.status,200);assert.equal((await response.json()).requiresEmail,true);
      pending=cookie(response);const state=await me(pending);assert.equal(state.requiresEmail,true);assert.equal(state.learner,null);assert.equal(state.platformAdmin,false);
      assert.equal((await invoke(m.courses,'GET','/api/courses',undefined,pending)).status,401);
      assert.equal((await invoke(m.users,'GET','/api/users',undefined,pending)).status,403);
      assert.equal((await invoke(m.courseAdmin,'GET','/api/admin/courses',undefined,pending)).status,403);
      assert.equal((await invoke(m.prototype,'POST','/api/prototype',{action:'view',key:'welcome'},pending)).status,401);
    }
    assert.equal((await login('historic-email',{password:'bad-password'})).status,401);
    assert.equal((await complete('', 'orphan@example.test')).status,401);
    assert.equal((await complete(pending,'new-historic@example.test',{origin:'https://evil.invalid'})).status,403);
    assert.equal((await complete(pending,'not-an-email')).status,400);
  });
  await check('Email capture rejects duplicate and archived emails case-insensitively, keeps history, rotates sessions and works only once',async()=>{
    await create('duplicate-email','Duplicate@Example.test');
    await query('UPDATE learners SET archived_at=? WHERE id=?','2026-01-01','duplicate-email').run();
    assert.equal((await complete(pending,' DUPLICATE@example.test ')).status,409);
    assert.equal((await complete(pending,process.env.PRIMARK_ADMIN_EMAIL)).status,409);
    assert.equal((await query('SELECT email FROM learners WHERE id=?','historic-email').first()).email,null);
    const response=await complete(pending,' Unique-Historic@example.test ');assert.equal(response.status,200);completed=cookie(response);
    assert.equal((await me(completed)).account.email,'unique-historic@example.test');assert.equal((await me(completed)).platformAdmin,true);
    assert.equal((await me(pending)).learner,null);assert.equal((await complete(pending,'other@example.test')).status,401);
    const learner=await query('SELECT email,legacy_access_code,workday_id FROM learners WHERE id=?','historic-email').first();
    assert.equal(learner.email,'unique-historic@example.test');assert.equal(learner.legacy_access_code,'HISTORIC-EMAIL');assert.equal(learner.workday_id,'WD-HISTORIC-EMAIL');
    assert(await query('SELECT module_key FROM module_views WHERE learner_id=?','historic-email').first());
    for(const id of [learner.email,learner.legacy_access_code,learner.workday_id]){const r=await login(id);assert.equal(r.status,200);assert.equal((await r.json()).requiresEmail,undefined);}
    await assert.rejects(query('UPDATE learners SET email=? WHERE id=?',' UNIQUE-HISTORIC@EXAMPLE.TEST ','duplicate-email').run(),e=>e.code==='23505');
  });
  await check('Expired, archived and concurrent pending sessions cannot overwrite email or obtain access',async()=>{
    await create('expired-login');const expired=cookie(await login('expired-login'));
    await query('UPDATE sessions SET expires_at=? WHERE learner_id=?','2000-01-01','expired-login').run();
    assert.equal((await complete(expired,'expired@example.test')).status,401);
    const archived=cookie(await login('expired-login'));await query('UPDATE learners SET archived_at=? WHERE id=?','2026-01-01','expired-login').run();
    assert.equal((await complete(archived,'archived-login@example.test')).status,401);assert.equal((await login('expired-login')).status,401);
    await create('two-sessions');const first=cookie(await login('two-sessions')),second=cookie(await login('two-sessions'));
    assert.equal((await complete(first,'two-sessions@example.test')).status,200);assert.equal((await complete(second,'overwrite@example.test')).status,401);
    assert.equal((await me(second)).learner,null);
  });
  await check('Edit User exposes retained codes read-only, cannot change them through PATCH, and does not generate codes for new accounts',async()=>{
    const response=await invoke(m.users,'GET','/api/users?search=HISTORIC-EMAIL',undefined,admin);assert.equal(response.status,200);
    const target=(await response.json()).people.find(p=>p.id==='historic-email');assert.equal(target.legacy_access_code,'HISTORIC-EMAIL');
    const edit=await invoke(m.users,'PATCH','/api/users',{id:target.id,revision:target.revision,action:'details',name:target.name,email:target.email,workdayId:target.workday_id,legacy_access_code:'MUTATED',legacyAccessCode:'MUTATED'},admin);assert.equal(edit.status,200,await edit.clone().text());
    assert.equal((await query('SELECT legacy_access_code FROM learners WHERE id=?',target.id).first()).legacy_access_code,'HISTORIC-EMAIL');
    assert.equal((await query('SELECT legacy_access_code FROM learners WHERE email=?','new@example.test').first()).legacy_access_code,null);
  });
  await check('Ambiguous imported aliases cannot choose the wrong account and legacy aliases share the account rate limit',async()=>{
    await create('ambiguous-one','ambiguous-one@example.test');await create('ambiguous-two','ambiguous-two@example.test','WD-AMBIGUOUS-ONE');
    assert.equal((await login('WD-AMBIGUOUS-ONE')).status,401);
    await create('legacy-rate');for(let i=0;i<10;i++)assert.equal((await login(i%2?'legacy-rate':'wd-legacy-rate',{password:'wrong'})).status,401);
    assert.equal((await login('legacy-rate')).status,429);
    await query('DELETE FROM platform_admins WHERE learner_id=?','historic-email').run();
  });
}
