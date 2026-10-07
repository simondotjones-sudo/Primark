import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export async function coursePanelChecks({m,check,query,invoke,loginAdmin}) {
  const admin=await loginAdmin();
  const body={title:'Panel metadata check',description:'',status:'draft',audience:{countries:[],sites:[],users:[]},category:'Fire Safety',catalogueScope:'countries',availableCountries:['Germany'],languageCode:'en'};
  const save=b=>invoke(m.courseAdmin,'POST','/api/admin/courses',b,admin);
  let course;
  await check('Optional course duration and lesson count default to unknown and survive omitted updates',async()=>{
    const defaults=await query('SELECT estimated_duration_minutes,lesson_count FROM courses WHERE id=?','legacy-264').first();
    assert.deepEqual(defaults,{estimated_duration_minutes:null,lesson_count:null});
    const created=await save({...body,estimatedDurationMinutes:25,lessonCount:6});
    assert.equal(created.status,200);course=(await created.json()).course;
    assert.equal(course.estimated_duration_minutes,25);assert.equal(course.lesson_count,6);
    const updated=await save({...body,id:course.id,revision:course.revision});
    assert.equal(updated.status,200);course=(await updated.json()).course;
    assert.equal(course.estimated_duration_minutes,25);assert.equal(course.lesson_count,6);
    assert.equal((await save({...body,id:course.id,revision:course.revision-1,lessonCount:9})).status,409);
    assert.equal((await query('SELECT lesson_count FROM courses WHERE id=?',course.id).first()).lesson_count,6);
  });
  await check('Invalid editorial counts are rejected without changing saved values; blank values clear them',async()=>{
    for(const field of ['estimatedDurationMinutes','lessonCount']) {
      for(const value of [0,-1,1.5,'5',true,10081])assert.equal((await save({...body,id:course.id,revision:course.revision,[field]:value})).status,400,`${field}: ${value}`);
    }
    const cleared=await save({...body,id:course.id,revision:course.revision,estimatedDurationMinutes:null,lessonCount:null});
    assert.equal(cleared.status,200);course=(await cleared.json()).course;
    assert.equal(course.estimated_duration_minutes,null);assert.equal(course.lesson_count,null);
    assert.equal((await invoke(m.courseAdmin,'POST','/api/admin/courses',{...body,lessonCount:3})).status,403);
  });
  await check('Assigned course responses expose accurate panel metadata without exposing unassigned courses',async()=>{
    // The existing fixture has an authenticated learner cookie and a published course.
    const saved=await query('SELECT * FROM courses WHERE id=?','legacy-2509').first();
    const response=await save({...body,id:saved.id,revision:saved.revision,title:saved.title,status:saved.status,audience:JSON.parse(saved.audience_json),category:'Manual Handling',availableCountries:['Ireland'],estimatedDurationMinutes:15,lessonCount:4});
    assert.equal(response.status,200);
    await query('INSERT INTO course_assignments(course_id,learner_id,assigned_by,assigned_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING','legacy-2509','photo-learner','panel-test','2026-10-07').run();
    const result=await invoke(m.courses,'GET','/api/courses',undefined,'primark_session=photo-token');assert.equal(result.status,200);
    const courses=(await result.json()).courses;
    const visible=courses.find(c=>c.id==='legacy-2509');assert(visible);
    assert.equal(visible.estimatedDurationMinutes,15);assert.equal(visible.lessonCount,4);
    assert.deepEqual(visible.availableCountries,['Ireland']);assert.equal(visible.languageCode,'en');
    assert.equal(visible.scos.length,1);assert.equal(visible.lessonCount,4);
    assert(!courses.some(c=>c.id===course.id));
  });
  const render=details=>renderToStaticMarkup(createElement(m.CourseMetadata,{details}));
  const details={category:'Fire Safety',languageCode:'en',catalogueScope:'countries',availableCountries:['Germany'],estimatedDurationMinutes:null,lessonCount:null};
  await check('Country flags reflect availability, not language; unknown duration and counts stay hidden',async()=>{
    const html=render(details);
    assert.match(html,/country-flags\/de.svg/);assert.match(html,/Germany/);assert.match(html,/Language: /);assert.match(html,/English/);
    assert(!html.includes('/gb.svg'));assert(!html.includes('lesson'));assert(!html.includes('Approx.'));
    assert.match(render({...details,lessonCount:1,estimatedDurationMinutes:20}),/1 lesson<\/span>/);
    assert.match(render({...details,lessonCount:3}),/3 lessons<\/span>/);
    const global=render({...details,catalogueScope:'global'});assert.match(global,/All countries/);assert(!global.includes('country-flags/'));
    const unset=render({...details,catalogueScope:'unconfigured'});assert(!unset.includes('All countries'));assert(!unset.includes('Germany'));
    const multiple=render({...details,availableCountries:['Germany','Austria']});assert.match(multiple,/country-flags\/de.svg/);assert.match(multiple,/country-flags\/at.svg/);
    for(const country of new Set(m.stores.map(s=>s.country)))assert(existsSync(`public/country-flags/${m.panelDetails.countryFlagCodes[country]}.svg`),country);
  });
  await check('Progress bars respect completion status and never fabricate an unknown percentage',async()=>{
    const progress=(status,percent)=>renderToStaticMarkup(createElement(m.CourseProgress,{status,percent,title:'Example course'}));
    assert.match(progress('Not started',62),/value="0"/);
    assert.match(progress('In progress',37),/value="37"/);assert.match(progress('In progress',37),/37% complete/);
    for(const unknown of [null,NaN,-1,101]){const html=progress('In progress',unknown);assert(!html.includes('<progress'));assert(!html.includes('% complete'));assert.match(html,/In progress/);}
    const completed=progress('Completed',48);assert.match(completed,/value="100"/);assert.match(completed,/is-complete/);assert.match(completed,/Completed/);
  });
}
