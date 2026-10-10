import assert from 'node:assert/strict';

export async function dashboardReportingChecks({m,check,query,invoke,read,cookies,loginAdmin,store,uk,course,audience,progress}){
  const NativeDate=Date,now=Date.parse('2026-10-10T12:00:00.000Z'),day=86400000;
  // Hold the request clock still to exercise both exact expiry-window boundaries.
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  try{
    const admin=await loginAdmin();
    for(const id of ['dashboard-a','dashboard-b'])await course(id,'Dashboard checks',audience(),{validity:1});
    const addPerson=async(id,site=store,archived=null)=>{
      await query('INSERT INTO learners(id,name,email,workday_id,code_hash,store_id,country,entered_at,induction_enrolled,archived_at) VALUES(?,?,?,?,?,?,?,?,true,?)',id,'Dashboard '+id,id+'@example.test','WD-'+id.toUpperCase(),'unused',site.id,site.country,'2026-01-01',archived).run();
    };
    const cert=async(id,courseId,expiry,extra={})=>{
      await query('INSERT INTO certificates(token,learner_id,course_id,package_id,course_title,learner_name,store_id,country,completed_at,expires_at,issued_at,archived_at,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id+courseId,id,courseId,courseId+'-package',courseId,id,store.id,store.country,'2026-01-01T12:00:00.000Z',expiry===null?null:new Date(expiry).toISOString(),'2026-01-01',extra.archived||null,extra.cancelled||null).run();
    };
    for(let i=1;i<=27;i++){const id='dashboard-'+String(i).padStart(2,'0');await addPerson(id);await cert(id,'dashboard-a',now+10*day);}
    await cert('dashboard-01','dashboard-b',now+30*day);
    await cert('dashboard-02','dashboard-b',now+30*day+1);
    for(const id of ['dashboard-expired','dashboard-not-started','dashboard-no-expiry','dashboard-archived-cert','dashboard-cancelled-cert'])await addPerson(id);
    await cert('dashboard-expired','dashboard-a',now);
    await cert('dashboard-no-expiry','dashboard-a',null);
    await cert('dashboard-archived-cert','dashboard-a',now+day,{archived:new Date(now-day).toISOString()});
    await cert('dashboard-cancelled-cert','dashboard-a',now+day,{cancelled:new Date(now-day).toISOString()});
    await addPerson('dashboard-archived-user',store,'2026-10-01');await cert('dashboard-archived-user','dashboard-a',now+day);
    await addPerson('dashboard-uk',uk);await cert('dashboard-uk','dashboard-a',now+day);
    await cert('report-site-admin','dashboard-a',now+day);
    await query('INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at) VALUES(?,?,?,?)','dashboard-not-started','dashboard-a','test','2026-01-01').run();
    await progress('dashboard-not-started','dashboard-b','one','incomplete');
    const selection='category=Dashboard+checks';
    await check('Dashboard compliance counts active assigned courses, excludes expired completions and returns N/A for no assignments',async()=>{
      const overview=await read(cookies['report-site'],selection);
      assert.equal(overview.metrics.assigned,33);assert.equal(overview.metrics.completed,30);assert.equal(overview.metrics.compliance,90.9);
      assert.equal(overview.metrics.expiringPeople,27);
      const empty=await read(cookies['report-site'],'course=missing-course');
      assert.equal(empty.metrics.assigned,0);assert.equal(empty.metrics.completed,0);assert.equal(empty.metrics.compliance,null);assert.equal(empty.metrics.expiringPeople,0);
      // Dashboard metrics remain current regardless of the historical chart dates.
      assert.deepEqual((await read(cookies['report-site'],selection+'&year=2020&month=1')).metrics,overview.metrics);
    });
    await check('Expiry drill-down counts people once and includes exactly the next 30 days using issued certificate expiry',async()=>{
      const first=await read(cookies['report-site'],'view=expiring&'+selection);
      assert.equal(first.totalPeople,27);assert.equal(first.pageSize,25);assert.equal(first.employees.length,25);assert.equal(first.hasMore,true);
      assert.equal(first.records.filter(r=>r.learnerId==='dashboard-01').length,2);
      assert(!first.records.some(r=>r.learnerId==='dashboard-02'&&r.courseId==='dashboard-b'));
      assert(first.records.every(r=>Date.parse(r.expiresAt)>now&&Date.parse(r.expiresAt)<=now+30*day));
      assert(!first.employees.some(p=>p.archivedAt));
      assert(!/token|code_hash|data_json|cancelled-cert|archived-cert/.test(JSON.stringify(first)));
      const second=await read(cookies['report-site'],'view=expiring&'+selection+'&page=2');
      assert.equal(second.employees.length,2);assert.equal(second.hasMore,false);
      assert.equal(new Set([...first.employees,...second.employees].map(p=>p.id)).size,27);
      const beyond=await read(cookies['report-site'],'view=expiring&'+selection+'&page=3');assert.equal(beyond.employees.length,0);assert.equal(beyond.hasMore,false);
    });
    await check('Expiry searches and course filters retain scope and keep card/list totals aligned for every admin role',async()=>{
      for(const cookie of [admin,cookies['report-org'],cookies['report-country'],cookies['report-site']]){
        for(const filter of [selection,'course=dashboard-a','course=dashboard-b']){
          const overview=await read(cookie,filter),list=await read(cookie,'view=expiring&'+filter);
          assert.equal(list.totalPeople,overview.metrics.expiringPeople);
        }
      }
      for(const search of ['Dashboard dashboard-01','dashboard-01@example.test','WD-dashboard-01']){
        const list=await read(cookies['report-site'],'view=expiring&'+selection+'&search='+encodeURIComponent(search));assert.equal(list.totalPeople,1);assert.equal(list.records.length,2);
      }
      for(const search of ['dashboard-uk',"%' OR 1=1 --",'%','_'])assert.equal((await read(cookies['report-site'],'view=expiring&'+selection+'&search='+encodeURIComponent(search))).totalPeople,0);
      assert.equal((await read(cookies['report-org'],'view=expiring&'+selection+'&search=dashboard-uk')).totalPeople,1);
      for(const cookie of ['', 'primark_session=report-uk'])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=expiring',undefined,cookie)).status,403);
      for(const cookie of [cookies['report-site'],cookies['report-country']])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=expiring&role=site&site='+uk.id,undefined,cookie)).status,403);
      for(const params of ['page=0','page=1.5','page=1000001','search='+('a'.repeat(201))])assert.equal((await invoke(m.reporting,'GET','/api/reporting?view=expiring&'+params,undefined,cookies['report-site'])).status,400);
    });
  }finally{globalThis.Date=NativeDate;}
}
