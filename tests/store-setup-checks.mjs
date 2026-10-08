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
 await check('Revoking store setup permission immediately prevents creation',async()=>{
  await query('DELETE FROM reporting_access WHERE learner_id=?','store-setup-country').run();assert.equal((await post({action:'add',name:'Revoked test',country:store.country},cookies.country)).status,403);
 });
}
