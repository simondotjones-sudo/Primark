import assert from 'node:assert/strict';
export async function certificateChecks({m,check,query,first,call,learner,ireland,course,pack,context}) {
  await check('SCORM completion issues one immutable certificate and pausing retains learner access',async()=>{
    const records=(await call(m.certificates,'GET',undefined,{user:'irish-user'})).data.certificates;
    assert.equal(records.length,1);const cert=records[0];assert.equal(cert.package_id,pack);assert.equal(cert.expires_at,null);
    assert.match(cert.token,/^[a-f0-9]{64}$/);assert(cert.certificate_number>0);
    assert.equal((await m.certificateServer.certificateForToken(cert.token)).learner_name,'irish-user');
    assert.equal(await m.certificateServer.certificateForToken("' OR 1=1 --"),null);
    const page=()=>m.certificatePage({params:Promise.resolve({token:cert.token})});
    await assert.rejects(context.run({},page),/redirect/);
    await assert.rejects(context.run({user:'uk-user'},page),/not-found/);
    assert(await context.run({user:'irish-user'},page));
    assert.equal((await call(m.certificates,'GET')).status,401);
    assert.equal((await call(m.certificates,'GET',undefined,{user:'uk-user'})).data.certificates.length,0);
    await query('SELECT issue_course_certificate(?,?)','irish-user',pack);
    assert.equal(Number((await first('SELECT count(*) n FROM certificates WHERE learner_id=?','irish-user')).n),1);
  });
  const id='cert-multi',pid=id+'-package';
  await query('INSERT INTO courses(id,title,status,audience_json,created_at,updated_at,validity_months) VALUES(?,?,?,?,?,?,?)',id,'Fire safety','published',JSON.stringify({countries:['Ireland'],sites:[],users:[]}),'2026-01-01','2026-01-01',12);
  await query('INSERT INTO course_packages(id,course_id,filename,status,scos_json,file_count,total_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)',pid,id,'test.zip','ready',JSON.stringify(['one','two'].map(id=>({id,title:id,href:'index.html',mastery:'80',launchData:''}))),1,10,'2026-01-01');
  await query('UPDATE courses SET package_id=? WHERE id=?',pid,id);
  const launch=async(user,scoId,preview=false)=>call(m.runtime,'POST',{action:'launch',courseId:id,scoId,preview},{user,admin:preview});
  const save=async(user,token,sequence,status)=>call(m.runtime,'POST',{action:'save',token,sequence,data:{'cmi.core.lesson_status':status,'cmi.core.session_time':'0000:00:01.00'}},{user});
  let one,two,issued;
  await check('Certificates require every SCO, ignore failed attempts and never issue for an admin preview',async()=>{
    const preview=await launch('', 'one', true);assert.equal(preview.status,200);
    await call(m.runtime,'POST',{action:'save',token:preview.data.token,sequence:1,data:{'cmi.core.lesson_status':'passed'}},{admin:true});
    one=(await launch('irish-user','one')).data;two=(await launch('irish-user','two')).data;
    assert.equal((await save('irish-user',one.token,1,'passed')).status,200);
    assert.equal((await save('irish-user',two.token,1,'failed')).status,200);
    assert.equal(await first('SELECT * FROM certificates WHERE package_id=?',pid),undefined);
    assert.equal((await save('irish-user',two.token,2,'completed')).status,200);
    issued=await first('SELECT * FROM certificates WHERE package_id=?',pid);assert(issued);
    assert.equal(issued.expires_at,m.reportTypes.completionExpiry(issued.completed_at,12));
    const tile=(await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.find(c=>c.id===id);
    assert.equal(tile.certificate.token,issued.token);assert.equal(tile.certificate.expiresAt,issued.expires_at);
  });
  await check('Changing renewal policy and title preserves issued evidence and reporting expiry',async()=>{
    const before=await first('SELECT * FROM courses WHERE id=?',id);
    const changed=await call(m.admin,'POST',{id,revision:before.revision,title:'Fire safety updated',description:'',status:'published',audience:JSON.parse(before.audience_json),validityMonths:36},{admin:true});
    assert.equal(changed.status,200);assert.equal(changed.data.course.validity_months,36);
    await save('irish-user',two.token,3,'completed');
    assert.deepEqual(await first('SELECT * FROM certificates WHERE token=?',issued.token),issued);
    const report=await m.training.trainingReport([ireland.id]);
    const record=report.records.find(r=>r.learnerId==='irish-user'&&r.courseId===id);
    assert.equal(record.expiresAt,issued.expires_at);assert.equal(record.completedAt,issued.completed_at);
    await learner('new-cert-user',ireland);
    for(const sco of ['one','two']){const l=(await launch('new-cert-user',sco)).data;assert.equal((await save('new-cert-user',l.token,1,'passed')).status,200);}
    const newer=await first('SELECT * FROM certificates WHERE learner_id=?','new-cert-user');
    assert.equal(newer.course_title,'Fire safety updated');assert.equal(newer.validity_months,36);
    assert.equal(newer.expires_at,m.reportTypes.completionExpiry(newer.completed_at,36));
  });
  await check('Expiry status handles the exact boundary, no-expiry and the 30-day warning consistently',async()=>{
    const at=Date.parse('2026-10-07T12:00:00.000Z');
    assert.equal(m.certificateTypes.certificateStatus(null,at),'Valid');
    assert.equal(m.certificateTypes.certificateStatus('2026-10-07T12:00:00.000Z',at),'Expired');
    assert.equal(m.certificateTypes.certificateStatus('2026-10-08T12:00:00.000Z',at),'Expiring soon');
    assert.equal(m.certificateTypes.certificateStatus('2026-12-08T12:00:00.000Z',at),'Valid');
    assert.equal(m.certificateTypes.certificateDate(null),'No expiry');
  });
  await check('Induction passports use the learner certificate snapshot and remain in Certifications',async()=>{
    await query("UPDATE courses SET category=' Induction ' WHERE id=?",id);
    const own=(await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.find(c=>c.id===id);
    assert.equal(own.passport.token,issued.token);assert.equal(own.passport.certificate_number,issued.certificate_number);
    assert.equal(own.passport.learner_name,issued.learner_name);assert.equal(own.passport.course_title,issued.course_title);
    assert.equal(own.passport.completed_at,issued.completed_at);assert.equal(own.passport.expires_at,issued.expires_at);
    assert(own.passport.store_name);assert(!('learner_id' in own.passport));
    const listed=(await call(m.certificates,'GET',undefined,{user:'irish-user'})).data.certificates;
    assert(listed.some(c=>c.token===own.passport.token));
    const other=(await call(m.courses,'GET',undefined,{user:'new-cert-user'})).data.courses.find(c=>c.id===id);
    assert.notEqual(other.passport.token,issued.token);assert.equal(other.passport.learner_name,'new-cert-user');
    await query("UPDATE certificates SET cancelled_at=now() WHERE token=?",issued.token);
    assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.find(c=>c.id===id).passport,null);
    await query("UPDATE certificates SET cancelled_at=NULL,archived_at=now() WHERE token=?",issued.token);
    assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.find(c=>c.id===id).passport,null);
    await query("UPDATE certificates SET archived_at=NULL WHERE token=?",issued.token);
    await query("UPDATE courses SET category='Fire Safety' WHERE id=?",id);
    assert.equal((await call(m.courses,'GET',undefined,{user:'irish-user'})).data.courses.find(c=>c.id===id).passport,null);
  });

}
