import {validateQuiz} from '@/lib/course-quiz';
import {inTransaction} from '@/lib/database';
import {creditError} from '@/lib/credits';
import { activeLearnerSql } from '@/lib/account-type';
import { NextRequest } from 'next/server';
import { db } from '@/lib/server';
import { bodyJson, failed, getCourse, getPackage, json, now, requireAdmin, validateAudience, CourseError } from '@/lib/course-admin';
import { type Course, type Person } from '@/lib/course-types';
import {storeDirectory} from '@/lib/store-directory';
import { courseLanguages } from '@/lib/course-catalogue';
export const dynamic='force-dynamic';
function optionalPositiveInteger(value: unknown, existing: number | null | undefined, label: string, max: number) {
  if (value === undefined) return existing ?? null;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new CourseError(`${label} must be a whole number from 1 to ${max.toLocaleString('en-GB')}, or left blank.`);
  return value;
}
export async function GET() { try {
  await requireAdmin();
  const [courses,people,packages,progress] = await Promise.all([
    db().prepare(`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('country',r.country,'courseId',r.refresher_course_id) ORDER BY r.country) FROM course_refresher_rules r WHERE r.source_course_id=c.id),'[]'::jsonb) AS refresher_rules FROM courses c ORDER BY updated_at DESC`).all<Course>(),
    db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id FROM learners l WHERE ${activeLearnerSql()} ORDER BY name`).all<Person>(),
    db().prepare("SELECT * FROM course_packages WHERE status='ready'").all<any>(),
    db().prepare('SELECT learner_id,package_id,sco_id,status,score,updated_at FROM scorm_progress').all<any>(),
  ]);
  return json({courses:courses.results,people:people.results,packages:packages.results,progress:progress.results});
} catch(e) { return failed(creditError(e)); } }
export async function POST(request: NextRequest) { try {
  await requireAdmin(request);
 const stores=await storeDirectory(false);const storeById=new Map(stores.map(s=>[s.id,s]));
  const b=await bodyJson(request,250000); const title=typeof b.title==='string'?b.title.trim():''; const description=typeof b.description==='string'?b.description.trim():'';
  if (!title || title.length>150 || description.length>2000) throw new CourseError('Add a course title (up to 150 characters) and a description of up to 2,000 characters.');
  if (!['draft','published'].includes(b.status)) throw new CourseError('Invalid course status.');
  const audience=await validateAudience(b.audience);
  const existing=b.id?await getCourse(b.id):null;
  if (b.id && !existing) throw new CourseError('Course not found.',404);
  const rules=b.refresherRules===undefined?(existing?.refresher_rules??[]):b.refresherRules;
  if(!Array.isArray(rules)||rules.length>30||rules.some(r=>!r||typeof r.country!=='string'||!stores.some(s=>s.country===r.country)||typeof r.courseId!=='string'||r.courseId===b.id)||new Set(rules.map(r=>r.country)).size!==rules.length)throw new CourseError('Choose valid refresher rules.');
  const targets=await db().prepare('SELECT id FROM courses').all<{id:string}>();
  if(rules.some(r=>!targets.results.some(c=>c.id===r.courseId)))throw new CourseError('Choose valid refresher rules.');
  const deadlineDays=optionalPositiveInteger(b.deadlineDays,existing?.deadline_days,'Deadline',3650);
  let quiz;try{quiz=validateQuiz(b.quiz===undefined?existing?.quiz_json??null:b.quiz);}catch(e){throw new CourseError((e as Error).message);}
  const validityMonths=optionalPositiveInteger(b.validityMonths,existing?.validity_months,'Validity',120);
  const duration=optionalPositiveInteger(b.estimatedDurationMinutes,existing?.estimated_duration_minutes,'Estimated duration',10080);
  const lessonCount=optionalPositiveInteger(b.lessonCount,existing?.lesson_count,'Lesson count',1000);
  const englishTitle=typeof b.englishTitle==='string'?b.englishTitle.trim():existing?.english_title||title;
  const category=typeof b.category==='string'?b.category.trim():existing?.category||'';
  const languageCode=b.languageCode??existing?.language_code??'en';
  const catalogueScope=b.catalogueScope??existing?.catalogue_scope??'unconfigured';
  const availableCountries=b.availableCountries??JSON.parse(existing?.available_countries_json||'[]');
  const inductionRole=b.inductionRole??existing?.induction_role??'none';
  if(englishTitle.length>150||category.length>80||!Object.hasOwn(courseLanguages,languageCode))throw new CourseError('Check the English title, category and language.');
  if(!['unconfigured','countries','global'].includes(catalogueScope)||!Array.isArray(availableCountries)||availableCountries.length>30||availableCountries.some(c=>typeof c!=='string'||!stores.some(s=>s.country===c)))throw new CourseError('Choose valid catalogue countries.');
  const linkedCountries=catalogueScope==='countries'?[...new Set(availableCountries)]:[];
  if(catalogueScope==='countries'&&!linkedCountries.length)throw new CourseError('Select at least one country.');
  if(!['none','country','default'].includes(inductionRole)||(inductionRole==='country'&&catalogueScope!=='countries')||(inductionRole==='default'&&(languageCode!=='en'||catalogueScope!=='global')))throw new CourseError('Country induction needs country availability. The default induction must be English and available in all countries.');
  if (b.status==='published') {
    if (!existing?.package_id || (await getPackage(existing.package_id))?.status!=='ready') throw new CourseError('Upload and validate a SCORM package before publishing.');
    if (!audience.countries.length&&!audience.sites.length&&!audience.users.length&&catalogueScope==='unconfigured') throw new CourseError('Choose an audience or make the course available in the country library before publishing.');
    if(inductionRole!=='none'){
      const others=await db().prepare("SELECT * FROM courses WHERE status='published' AND induction_role=? AND id<>?").bind(inductionRole,existing!.id).all<Course>();
      if(others.results.some(c=>inductionRole==='default'||JSON.parse(c.available_countries_json).some((country:string)=>linkedCountries.includes(country))))throw new CourseError('Another published induction already uses this default or country. Pause it before publishing this version.',409);
    }
  }
  const id=existing?.id||crypto.randomUUID(); const date=now();
  await inTransaction(async client=>{
  if (existing) {
    const statement=db().prepare('UPDATE courses SET title=?,description=?,audience_json=?,status=?,english_title=?,category=?,language_code=?,catalogue_scope=?,available_countries_json=?,induction_role=?,estimated_duration_minutes=?,lesson_count=?,validity_months=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
      .bind(title,description,JSON.stringify(audience),b.status,englishTitle,category,languageCode,catalogueScope,JSON.stringify(linkedCountries),inductionRole,duration,lessonCount,validityMonths,date,id,b.revision);
    const result=await statement.execute(client);
    if (!result.rowCount) throw new CourseError('This course changed in another session. Reload it before saving.',409);
  } else await db().prepare('INSERT INTO courses(id,title,description,status,audience_json,created_at,updated_at,english_title,category,language_code,catalogue_scope,available_countries_json,induction_role,estimated_duration_minutes,lesson_count,validity_months) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,title,description,b.status,JSON.stringify(audience),date,date,englishTitle,category,languageCode,catalogueScope,JSON.stringify(linkedCountries),inductionRole,duration,lessonCount,validityMonths).execute(client);
  await client.query('UPDATE courses SET deadline_days=$2,quiz_json=$3 WHERE id=$1',[id,deadlineDays,quiz===null?null:JSON.stringify(quiz)]);
  await client.query('DELETE FROM course_refresher_rules WHERE source_course_id=$1',[id]);
  for(const rule of rules)await client.query('INSERT INTO course_refresher_rules(source_course_id,country,refresher_course_id) VALUES($1,$2,$3)',[id,rule.country,rule.courseId]);
  if(b.status==='published')await client.query('SELECT sync_credit_assignments()');
  });
  return json({course:await getCourse(id)});
} catch(e) { return failed(creditError(e)); } }
