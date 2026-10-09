import assert from 'node:assert/strict';
export async function storeSetupChecks({m,check,query,invoke,loginAdmin,cookieFrom,store,uk}){
 const bootstrap=await loginAdmin(),endpoint='/api/admin/organisation',password='Store-setup-test-password';
 const passwordHash=await m.learnerAuth.hashPassword(password);
 const cookies={};
 for(const scope of ['site','country','organisation']){
  const id='store-setup-'+scope;
  await query('INSERT INTO learners(id,name,email,password_hash,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?,?)',id,id,id+'@example.test',passwordHash,await m.hash(id),store.id,store.country,'2026-10-08').run();
  await query('INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at) VALUES(?,?,?,?,?,?)',id,scope,scope==='organisation'?null:store.country,scope==='site'?store.id:null,'test','2026-10-08').run();
  await query('INSERT INTO sessions(token_hash,learner_id,expires_at) VALUES(?,?,?)',await m.hash(id),id,'2099-01-01').run();cookies[scope]='primark_session='+id;
 }
 const post=(body,cookie=bootstrap,headers={})=>invoke(m.organisation,'POST',endpoint,body,cookie,headers);
 const get=(cookie)=>invoke(m.organisation,'GET',endpoint,undefined,cookie);
 await check('Organisation and country admins access store setup; country admins cannot add or change foreign stores',async()=>{
  assert.equal((await get(cookies.site)).status,403);
  const local=await (await get(cookies.country)).json();assert.equal(local.canAddCountry,false);assert(local.stores.every(s=>s.country===store.country));
  const organisation=await (await get(cookies.organisation)).json();assert(organisation.canAddCountry);assert(organisation.stores.some(s=>s.country===uk.country));
  for(const action of ['archive','restore'])assert.equal((await post({action,id:uk.id},cookies.country)).status,403);
  assert.equal((await post({action:'add',name:'Foreign test',country:uk.country},cookies.country)).status,403);
  assert.equal((await post({action:'add',name:'New country test',country:'Setup Republic',newCountry:true},cookies.country)).status,403);
  assert.equal((await post({action:'add',name:'Local test',country:store.country},cookies.country,{origin:'https://evil.invalid'})).status,403);
  const r=await post({action:'add',name:'Local setup test',country:store.country.toLowerCase(),storeCode:' local-001 '},cookies.country);assert.equal(r.status,200,await r.clone().text());
  const added=(await r.json()).stores.find(s=>s.name==='Local setup test');assert.equal(added.country,store.country);assert.equal(added.storeCode,'LOCAL-001');
  for(const action of ['archive','restore'])assert.equal((await post({action,id:added.id},cookies.country)).status,200);
  assert.equal((await query('SELECT updated_by FROM organisation_stores WHERE id=?',added.id).first()).updated_by,'store-setup-country@example.test');
  const views=m.profile.profileViews({platformAdmin:false,reportingAccess:{scope:'country',country:store.country,siteId:null}});assert(views.some(v=>v.value==='organisation'));
  assert(!m.profile.profileViews({platformAdmin:false,reportingAccess:{scope:'site',country:store.country,siteId:store.id}}).some(v=>v.value==='organisation'));
 });
 await check('New countries are explicit and store codes are unique, validated and retained on archive/restore',async()=>{
  assert.equal((await post({action:'add',name:'New market',country:'Setup Republic'},cookies.organisation)).status,400);
  const r=await post({action:'add',name:'New market',country:'Setup Republic',newCountry:true,storeCode:'NEW-001'},cookies.organisation);assert.equal(r.status,200,await r.clone().text());
  const added=(await r.json()).stores.find(s=>s.name==='New market');assert.equal(added.country,'Setup Republic');
  assert.equal((await post({action:'add',name:'Duplicate code',country:store.country,storeCode:'new-001'})).status,409);
  assert.equal((await post({action:'add',name:'Invalid code',country:store.country,storeCode:'bad code'})).status,400);
  for(const action of ['archive','restore'])assert.equal((await post({action,id:added.id},cookies.organisation)).status,200);
  assert.equal((await query('SELECT store_code FROM organisation_stores WHERE id=?',added.id).first()).store_code,'NEW-001');
 });
 await check('Store and manager account creation is atomic, scoped, private and ready for password setup',async()=>{
  const r=await post({action:'add',name:'Manager setup test',country:store.country,storeCode:'ADMIN-001',adminEmail:'  New.Store.Manager@Example.test  ',adminPassword:password},cookies.country);assert.equal(r.status,200,await r.clone().text());
  const payload=await r.json(),added=payload.stores.find(s=>s.name==='Manager setup test');assert(payload.adminCreated);assert(!payload.passwordSetupPending);assert.equal(added.adminEmail,'new.store.manager@example.test');
  const person=await query('SELECT * FROM learners WHERE email=?',added.adminEmail).first();assert.equal(person.store_id,added.id);assert.equal(person.induction_enrolled,false);
  assert.equal((await query('SELECT store_id FROM store_managers WHERE learner_id=?',person.id).first()).store_id,added.id);
  assert.equal((await query('SELECT site_id FROM reporting_access WHERE learner_id=?',person.id).first()).site_id,added.id);
  const login=await invoke(m.prototype,'POST','/api/prototype',{action:'login',email:person.email,password});assert.equal(login.status,200);
  const cookie='primark_session='+cookieFrom(login,'primark_session');assert.equal((await get(cookie)).status,403,'Store managers cannot administer stores');
  assert.equal((await invoke(m.users,'GET','/api/users',undefined,cookie)).status,200);
  const publicStores=await m.directory.storeDirectory();assert(!publicStores.some(s=>s.adminEmail),'Admin addresses are not exposed in the public store directory');
  await query('UPDATE learners SET email=? WHERE id=?','updated.manager@example.test',person.id).run();assert.equal((await (await get(cookies.country)).json()).stores.find(s=>s.id===added.id).adminEmail,'updated.manager@example.test');
  const before=(await query('SELECT COUNT(*)::int AS n FROM organisation_stores').first()).n;
  for(const body of [{storeCode:'ADMIN-001',adminEmail:'rollback-admin@example.test'},{adminEmail:'updated.manager@example.test'},{adminEmail:process.env.PRIMARK_ADMIN_EMAIL},{adminEmail:'bad-email'},{adminEmail:'short-password@example.test',adminPassword:'short'}])assert([400,409].includes((await post({action:'add',name:'Rollback store',country:store.country,...body})).status));
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM organisation_stores').first()).n,before);assert.equal(await query('SELECT id FROM learners WHERE email=?','rollback-admin@example.test').first(),null);
  const pending=await post({action:'add',name:'Pending password store',country:store.country,adminEmail:'pending.store.admin@example.test'});assert.equal(pending.status,200);assert((await pending.json()).passwordSetupPending);
  const audit=await query('SELECT * FROM organisation_store_audit WHERE store_id=?',added.id).all();assert.equal(audit.results[0].actor,'store-setup-country@example.test');assert(!JSON.stringify(audit).includes(password));
 });
 let editStore;
 await check('Store details save name, code and contact without changing account credentials or credit balances',async()=>{
  const create=await post({action:'add',name:'Edit details fixture',country:store.country,storeCode:'EDIT-001',adminEmail:'edit-admin@example.test',adminPassword:password});
  assert.equal(create.status,200);editStore=(await create.json()).stores.find(s=>s.storeCode==='EDIT-001');
  const manager=await query('SELECT * FROM learners WHERE email=?','edit-admin@example.test').first();
  const balance=await query('SELECT balance,target FROM store_credit_accounts WHERE store_id=?',editStore.id).first();
  const saved=await post({...editStore,action:'edit',name:'Updated store',storeCode:'007-EDIT',adminEmail:' Store.Contact@Example.test ',learnerCount:999},cookies.country);
  assert.equal(saved.status,200,await saved.clone().text());editStore=(await saved.json()).stores.find(s=>s.id===editStore.id);
  assert.equal(editStore.name,'Updated store');assert.equal(editStore.storeCode,'007-EDIT');assert.equal(editStore.adminEmail,'store.contact@example.test');assert.equal(editStore.learnerCount,0);
  assert.deepEqual(await query('SELECT * FROM learners WHERE id=?',manager.id).first(),manager);
  assert.deepEqual(await query('SELECT balance,target FROM store_credit_accounts WHERE store_id=?',editStore.id).first(),balance);
  assert.equal((await query('SELECT store_name FROM store_credit_accounts WHERE store_id=?',editStore.id).first()).store_name,'Updated store');
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM organisation_store_audit WHERE store_id=? AND action='edit'",editStore.id).first()).n,1);
 });
 await check('Learner count includes active learners only and remains private and read-only',async()=>{
  for(const [id,archived] of [['edit-active',null],['edit-archived','2026-10-08']])await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,archived_at) VALUES(?,?,?,?,?,?,?,?)',id,id,id+'@example.test',id,editStore.id,store.country,'2026-10-09',archived).run();
  editStore=(await (await get(cookies.country)).json()).stores.find(s=>s.id===editStore.id);assert.equal(editStore.learnerCount,1);
  const publicStore=(await m.directory.storeDirectory()).find(s=>s.id===editStore.id);assert(!publicStore.adminEmail);assert.equal(publicStore.learnerCount,undefined);assert.equal(publicStore.revision,undefined);
  const saved=await post({...editStore,action:'edit',adminEmail:'',learnerCount:900});assert.equal(saved.status,200);editStore=(await saved.json()).stores.find(s=>s.id===editStore.id);assert.equal(editStore.adminEmail,'');assert.equal(editStore.learnerCount,1);
 });
 await check('Edits reject duplicate codes, invalid email, stale changes and out-of-scope stores atomically',async()=>{
  const before=await query('SELECT * FROM organisation_stores WHERE id=?',editStore.id).first();
  for(const fields of [{storeCode:store.storeCode},{storeCode:'bad code'},{adminEmail:'not-an-email'},{revision:'stale'}])assert([400,409].includes((await post({...editStore,action:'edit',...fields})).status));
  assert.deepEqual(await query('SELECT * FROM organisation_stores WHERE id=?',editStore.id).first(),before);
  assert.equal((await post({...editStore,action:'edit',country:uk.country},cookies.country)).status,403);
  assert.equal((await post({...uk,action:'edit',country:store.country},cookies.country)).status,403,'Foreign store cannot be moved into scope');
  assert.equal((await post({...editStore,action:'edit'},cookies.site)).status,403);
  assert.equal((await post({...editStore,action:'edit'},cookies.country,{origin:'https://evil.invalid'})).status,403);
 });
 await check('Organisation admins can correct country while preserving IDs, grants, counts and archived state',async()=>{
  const archived=await post({action:'archive',id:editStore.id});assert.equal(archived.status,200);editStore=(await archived.json()).stores.find(s=>s.id===editStore.id);
  const saved=await post({...editStore,action:'edit',country:uk.country},cookies.organisation);assert.equal(saved.status,200,await saved.clone().text());editStore=(await saved.json()).stores.find(s=>s.id===editStore.id);
  assert.equal(editStore.active,false);assert.equal(editStore.country,uk.country);assert.equal(editStore.learnerCount,1);
  assert.equal((await query('SELECT country FROM learners WHERE id=?','edit-active').first()).country,uk.country);
  assert.equal((await query("SELECT country FROM reporting_access WHERE scope='site' AND site_id=?",editStore.id).first()).country,uk.country);
  const account=await query('SELECT country,active FROM store_credit_accounts WHERE store_id=?',editStore.id).first();assert.equal(account.country,uk.country);assert.equal(account.active,false);
  assert(!(await (await get(cookies.country)).json()).stores.some(s=>s.id===editStore.id));
 });
 let deletedStore;
 const newEmptyStore=async(name)=>{const response=await post({action:'add',name,country:store.country});assert.equal(response.status,200,await response.clone().text());const created=(await response.json()).stores.find(s=>s.name===name);const archived=await post({action:'archive',id:created.id});assert.equal(archived.status,200);return (await archived.json()).stores.find(s=>s.id===created.id);};
 await check('Deleting stores requires an archived eligible store, existing scope and same-origin protection',async()=>{
  assert.equal((await post({action:'delete',id:store.id})).status,409);
  assert.equal((await post({action:'delete',id:uk.id},cookies.country)).status,403);
  const candidate=await newEmptyStore('Deletion permission fixture');assert(candidate.canDelete);
  assert.equal((await post({action:'delete',id:candidate.id},cookies.site)).status,403);
  assert.equal((await post({action:'delete',id:candidate.id},cookies.country,{origin:'https://evil.invalid'})).status,403);
  assert((await m.directory.storeDirectory()).some(s=>s.id===candidate.id));
 });
 await check('An imported unused archived store disappears permanently and retains its audit and credit records',async()=>{
  const baseline=m.stores.find(s=>!s.active&&s.country===store.country);assert(baseline);
  // Remove only this test suite's synthetic capacity grant; production data is not used.
  await query("DELETE FROM credit_ledger WHERE store_id=? AND actor='test fixture capacity'",baseline.id).run();
  deletedStore=(await (await get(cookies.country)).json()).stores.find(s=>s.id===baseline.id);assert(deletedStore.canDelete);
  const ledger=(await query('SELECT * FROM credit_ledger WHERE store_id=? ORDER BY id',baseline.id).all()).results;
  const response=await post({action:'delete',id:baseline.id},cookies.country);assert.equal(response.status,200,await response.clone().text());
  assert(!(await response.json()).stores.some(s=>s.id===baseline.id));
  assert(!(await m.directory.storeDirectory(true,true)).some(s=>s.id===baseline.id));assert(!(await m.directory.storeDirectory()).some(s=>s.id===baseline.id));
  const tombstone=await query('SELECT deleted_at,deleted_by,active FROM organisation_stores WHERE id=?',baseline.id).first();assert(tombstone.deleted_at);assert.equal(tombstone.deleted_by,'store-setup-country@example.test');assert.equal(tombstone.active,false);
  assert.deepEqual((await query('SELECT * FROM credit_ledger WHERE store_id=? ORDER BY id',baseline.id).all()).results,ledger);
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM organisation_store_audit WHERE store_id=? AND action='delete'",baseline.id).first()).n,1);
  for(const action of ['restore','edit','delete'])assert.equal((await post({action,id:baseline.id})).status,400);
  assert(!(await m.directory.storeDirectory()).some(s=>'canDelete' in s));
 });
 await check('Active and archived learners, admin accounts and late links hide Delete and block forged requests',async()=>{
  for(const archived of [null,'2026-10-09']){
   const candidate=await newEmptyStore('Linked deletion '+String(archived)),id='delete-person-'+String(archived);
   assert(candidate.canDelete);
   await query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at,archived_at) VALUES(?,?,?,?,?,?,?,?)',id,id,id+'@example.test',id,candidate.id,store.country,'2026-10-09',archived).run();
   const refreshed=(await (await get(cookies.country)).json()).stores.find(s=>s.id===candidate.id);assert.equal(refreshed.learnerCount,archived?0:1);assert.equal(refreshed.canDelete,false);
   assert.equal((await post({action:'delete',id:candidate.id,canDelete:true,learnerCount:0})).status,409);
   assert.equal((await query('SELECT deleted_at FROM organisation_stores WHERE id=?',candidate.id).first()).deleted_at,null);
  }
  const response=await post({action:'add',name:'Admin-only deletion fixture',country:store.country,adminEmail:'delete-admin@example.test'});assert.equal(response.status,200);const candidate=(await response.json()).stores.find(s=>s.name==='Admin-only deletion fixture');
  await post({action:'archive',id:candidate.id});const refreshed=(await (await get(cookies.country)).json()).stores.find(s=>s.id===candidate.id);assert.equal(refreshed.learnerCount,0);assert.equal(refreshed.canDelete,false);assert.equal((await post({action:'delete',id:candidate.id})).status,409);
 });
 await check('Historical completion, course audience and credit activity protect empty archived stores',async()=>{
  for(const kind of ['legacy','audience','credits']){
   const candidate=await newEmptyStore('Protected deletion '+kind);
   if(kind==='legacy')await query('INSERT INTO legacy_completions(email,completed,store_id,imported_at) VALUES(?,1,?,?)','delete-history@example.test',candidate.id,'2026-10-09').run();
   if(kind==='audience')await query('INSERT INTO courses(id,title,audience_json,created_at,updated_at) VALUES(?,?,?,?,?)','delete-audience','Delete fixture',JSON.stringify({sites:[candidate.id]}),'2026-10-09','2026-10-09').run();
   if(kind==='credits')await query("INSERT INTO credit_ledger(id,store_id,kind,credits,recorded_at,actor) VALUES(?,?,'manual_topup',1,now(),'test')",crypto.randomUUID(),candidate.id).run();
   const refreshed=(await (await get(cookies.country)).json()).stores.find(s=>s.id===candidate.id);assert.equal(refreshed.learnerCount,0);assert.equal(refreshed.canDelete,false);assert.equal((await post({action:'delete',id:candidate.id})).status,409);
  }
 });
 await check('Database guards reject stale references or resurrection after deletion',async()=>{
  await assert.rejects(query('INSERT INTO learners(id,name,email,code_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?)','stale-delete','Stale','stale-delete@example.test','stale-delete',deletedStore.id,store.country,'2026-10-09').run(),error=>error.code==='23514');
  await assert.rejects(query('INSERT INTO courses(id,title,audience_json,created_at,updated_at) VALUES(?,?,?,?,?)','stale-deleted-audience','Stale',JSON.stringify({sites:[deletedStore.id]}),'2026-10-09','2026-10-09').run(),error=>error.code==='23514');
  await assert.rejects(query('UPDATE organisation_stores SET active=true WHERE id=?',deletedStore.id).run(),error=>error.code==='23514');
  assert.equal(await query('SELECT id FROM learners WHERE id=?','stale-delete').first(),null);
 });
 await check('Revoking store setup permission immediately prevents creation',async()=>{
  await query('DELETE FROM reporting_access WHERE learner_id=?','store-setup-country').run();assert.equal((await post({action:'add',name:'Revoked test',country:store.country},cookies.country)).status,403);
 });
}
