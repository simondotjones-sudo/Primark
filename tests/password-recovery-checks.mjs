import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function passwordRecoveryChecks({m,check,query,invoke,loginAdmin,cookieFrom,store}) {
  const envKeys=['POSTMARK_SERVER_TOKEN','POSTMARK_FROM_EMAIL','PRIMARK_APP_URL'];
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch, messages=[];
  const email='recovery-fixture@example.test', id='recovery-fixture', oldPassword='Original-Password-123';
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const request=(email,extra={})=>invoke(m.recovery,'POST','/api/password-recovery',{action:'request',email},'',extra);
  const reset=(token,password='Replacement-Password-123')=>invoke(m.recovery,'POST','/api/password-recovery',{action:'reset',token,password});
  const links=()=>[...messages.at(-1).TextBody.matchAll(/https:\/\/[^\s]+/g)].map(match=>new URL(match[0]));
  const tokens=()=>links().map(url=>new URLSearchParams(url.hash.slice(1)).get('token'));
  const login=(email,password)=>invoke(m.prototype,'POST','/api/prototype',{action:'login',email,password});
  try {
    await query('DELETE FROM auth_limits').run();
    process.env.POSTMARK_SERVER_TOKEN='fixture-token';process.env.POSTMARK_FROM_EMAIL='sender@example.test';process.env.PRIMARK_APP_URL='https://primark.example.test';
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.postmarkapp.com/email');messages.push(JSON.parse(options.body));return Response.json({ErrorCode:0});};
    await query('INSERT INTO learners(id,name,email,code_hash,password_hash,store_id,country,entered_at) VALUES(?,?,?,?,?,?,?,?)',id,'Recovery Fixture',email,await m.hash('legacy-unused'),await m.learnerAuth.hashPassword(oldPassword),store.id,store.country,'2026-01-01').run();
    await query('INSERT INTO module_views(learner_id,module_key,viewed_at) VALUES(?,?,?)',id,'welcome','2026-01-02').run();
    let token, spare, cookie;
    await check('Recovery sends only to the account email, hides account existence, and uses hashed 30-minute tokens with a trusted origin',async()=>{
      const known=await request(email,{host:'hostile.invalid',origin:'https://hostile.invalid'});assert.equal(known.status,200);
      token=tokens()[0];assert.match(token,/^[a-f0-9]{64}$/);assert.equal(links()[0].origin,'https://primark.example.test');
      assert.equal(links()[0].searchParams.get('lang'),'en');assert(!links()[0].searchParams.has('token'));assert.equal(messages.at(-1).To,email);assert.equal(messages.at(-1).TrackLinks,'None');
      const rows=(await query('SELECT * FROM password_resets').all()).results;
      assert(rows.some(row=>row.token_hash===digest(token)));assert(!JSON.stringify(rows).includes(token));
      const ttl=new Date(rows[0].expires_at).getTime()-Date.now();assert(ttl>29*60000&&ttl<=30*60000);
      const count=messages.length;const unknown=await request('unknown-recovery@example.test');assert.equal(unknown.status,known.status);assert.deepEqual(await known.json(),await unknown.json());assert.equal(messages.length,count);
      assert.equal((await request(email,{origin:'https://evil.invalid'})).status,403);
      assert.equal((await request('two,people@example.test')).status,400);
      const signed=await login(email,oldPassword);cookie='primark_session='+cookieFrom(signed,'primark_session');
      await request(email);spare=tokens()[0];
    });
    await check('Reset preserves learning and roles, changes login, revokes sessions, and rejects reuse and outstanding old links',async()=>{
      assert.equal((await reset(token,'short')).status,400);
      assert.equal((await reset(token)).status,200);
      assert.equal((await reset(token)).status,400);assert.equal((await reset(spare)).status,400);
      assert.equal((await login(email,oldPassword)).status,401);assert.equal((await login(email,'Replacement-Password-123')).status,200);
      const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,cookie)).json();assert.equal(state.learner,null);
      assert(await query('SELECT * FROM module_views WHERE learner_id=?',id).first());
      const row=await query('SELECT * FROM learners WHERE id=?',id).first();assert.equal(row.email,email);assert.equal(row.store_id,store.id);
    });
    await check('Expired, malformed and tampered reset tokens cannot change a password',async()=>{
      await request(email);const expiring=tokens()[0];
      await query("UPDATE password_resets SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=?",digest(expiring)).run();
      for(const token of [expiring,'z'.repeat(64),'f'.repeat(64),''])assert.equal((await reset(token)).status,400);
      assert.equal((await login(email,'Replacement-Password-123')).status,200);
    });
    await check('Platform admin recovery remains separate from a learner with the same email and revokes old admin sessions',async()=>{
      await query('DELETE FROM auth_limits').run();
      const adminEmail=process.env.PRIMARK_ADMIN_EMAIL, oldAdmin=await loginAdmin();
      // Prior authentication checks seeded an ordinary learner with the admin email.
      const learner=await query('SELECT * FROM learners WHERE email=?',adminEmail).first();assert(learner);
      const learnerHash=learner.password_hash;
      await request(adminEmail);assert.equal(tokens().length,2);const [adminToken,learnerToken]=tokens();
      assert.equal((await reset(adminToken,'Only-8-chars')).status,400);
      assert.equal((await reset(adminToken,'New-platform-secret-123')).status,200);
      assert.equal((await login(adminEmail,process.env.PRIMARK_ADMIN_PASSWORD)).status,401);
      const newAdmin=await login(adminEmail,'New-platform-secret-123');assert.equal(newAdmin.status,200);assert.equal((await newAdmin.json()).returnTo,'/?view=report');
      const state=await (await invoke(m.prototype,'GET','/api/prototype?view=me',undefined,oldAdmin)).json();assert.equal(state.platformAdmin,false);
      assert.equal((await query('SELECT password_hash FROM learners WHERE id=?',learner.id).first()).password_hash,learnerHash);
      assert.equal((await reset(learnerToken,'Separate-learner-password')).status,200);
      const ordinary=await login(adminEmail,'Separate-learner-password');assert.equal((await ordinary.json()).returnTo,undefined);
      assert.equal((await login(adminEmail,'New-platform-secret-123')).status,200);
      await query('DELETE FROM admin_passwords').run();
    });
    await check('Hosting credential rotation invalidates pending admin recovery links',async()=>{
      await query('DELETE FROM auth_limits').run();await request(process.env.PRIMARK_ADMIN_EMAIL);const token=tokens()[0];
      const old=process.env.PRIMARK_ADMIN_PASSWORD;
      try{process.env.PRIMARK_ADMIN_PASSWORD='Rotated-hosting-secret-123';assert.equal((await reset(token)).status,400);assert.equal((await login(process.env.PRIMARK_ADMIN_EMAIL,process.env.PRIMARK_ADMIN_PASSWORD)).status,200);}
      finally{process.env.PRIMARK_ADMIN_PASSWORD=old;}
    });
    await check('Recovery email and reset link preserve supported languages and reject unknown locale values',async()=>{
      for(const [lang,expected,subject] of [['it','it','Reimposta la password Primark'],['ar','ar','إعادة تعيين كلمة مرور Primark'],['unsupported','en','Reset your Primark password']]){
        await query('DELETE FROM auth_limits').run();
        const response=await invoke(m.recovery,'POST','/api/password-recovery',{action:'request',email,lang});
        assert.equal(response.status,200);assert.equal(links()[0].searchParams.get('lang'),expected);
        assert.equal(messages.at(-1).Subject,subject);assert.match(tokens()[0],/^[a-f0-9]{64}$/);
        assert(!links()[0].searchParams.has('token'));assert(messages.at(-1).TextBody.includes('30'));
      }
    });
    await check('Recovery throttles email delivery without exposing account existence',async()=>{
      await query('DELETE FROM auth_limits').run();const start=messages.length;
      for(let i=0;i<5;i++)assert.equal((await request(email)).status,200);assert.equal(messages.length-start,3);
      for(let i=0;i<25;i++)await request('throttled@example.test');assert.equal((await request(email)).status,429);
    });
    await check('Missing sender settings show an honest unavailable state; failed deliveries invalidate their tokens',async()=>{
      await query('DELETE FROM auth_limits').run();delete process.env.POSTMARK_SERVER_TOKEN;
      const missing=await request(email);assert.equal(missing.status,400);assert.match((await missing.json()).error,/not available yet/);
      process.env.POSTMARK_SERVER_TOKEN='fixture-token';
      await query('DELETE FROM password_resets').run();
      globalThis.fetch=async()=>Response.json({ErrorCode:422},{status:422});
      assert.equal((await request(email)).status,200);assert.equal(Number((await query('SELECT COUNT(*) AS count FROM password_resets').first()).count),0);
    });
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of envKeys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
    await query('DELETE FROM auth_limits').run();await query('DELETE FROM admin_passwords').run();
  }
}
