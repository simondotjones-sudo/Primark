import type { Certificate } from '@/lib/certificates';
import { db, storeById, type Learner } from '@/lib/server';
import { availableInCountry, inductionFor } from '@/lib/course-catalogue';
import { matchesAudience, type Course, type Sco } from '@/lib/course-types';
import stores from '@/lib/stores.json';
import { completionExpiry, ORIGINAL_INDUCTION, type TrainingRecord, type TrainingReport } from '@/lib/training-report-types';

type ReportPerson = Learner & {induction_enrolled:boolean};
type ReadyCourse = Course & {scos_json:string};
type Progress = {learner_id:string;package_id:string;sco_id:string;status:string;score:string|null;completed_at:string|null};
export async function trainingReport(siteIds:string[]|null):Promise<TrainingReport> {
  const where=siteIds ? `l.store_id IN (${siteIds.map(()=>'?').join(',')})` : '1=1';
  const args=siteIds||[];
  // Every query containing learner information is scoped on the server, before aggregation.
  const [people,courses,assignments,inductions,progress,legacy,certificates]=await Promise.all([
    db().prepare(`SELECT l.id,l.name,l.email,l.store_id,l.country,l.entered_at,l.started_at,l.completed_at,l.best_score,l.induction_enrolled FROM learners l WHERE ${where} ORDER BY l.name,l.id`).bind(...args).all<ReportPerson>(),
    db().prepare("SELECT c.*,p.scos_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE p.status='ready' ORDER BY c.title,c.id").all<ReadyCourse>(),
    db().prepare(`SELECT a.learner_id,a.course_id FROM course_assignments a JOIN learners l ON l.id=a.learner_id WHERE ${where}`).bind(...args).all<{learner_id:string;course_id:string}>(),
    db().prepare(`SELECT a.learner_id,a.course_id FROM learner_inductions a JOIN learners l ON l.id=a.learner_id WHERE ${where}`).bind(...args).all<{learner_id:string;course_id:string}>(),
    db().prepare(`SELECT p.learner_id,p.package_id,p.sco_id,p.status,p.score,p.completed_at FROM scorm_progress p JOIN learners l ON l.id=p.learner_id WHERE ${where}`).bind(...args).all<Progress>(),
    db().prepare(`SELECT c.email,c.completed_at,COALESCE(l.store_id,c.store_id) AS store_id FROM legacy_completions c LEFT JOIN learners l ON l.email=c.email WHERE c.completed=1 AND ${siteIds?`COALESCE(l.store_id,c.store_id) IN (${siteIds.map(()=>'?').join(',')})`:'1=1'}`).bind(...args).all<{email:string;completed_at:string|null;store_id:string|null}>(),
    db().prepare(`SELECT cert.* FROM certificates cert JOIN learners l ON l.id=cert.learner_id WHERE ${where}`).bind(...args).all<Certificate>(),
  ]);
  const key=(a:string,b:string)=>JSON.stringify([a,b]);
  const certificateMap=new Map(certificates.results.map(c=>[key(c.learner_id,c.package_id||''),c]));
  const assigned=new Set(assignments.results.map(a=>key(a.learner_id,a.course_id)));
  const inductionMap=new Map(inductions.results.map(a=>[a.learner_id,a.course_id]));
  const progressMap=new Map<string,Progress[]>();
  for(const p of progress.results){const k=key(p.learner_id,p.package_id);const rows=progressMap.get(k)||[];rows.push(p);progressMap.set(k,rows);}
  const scopeCountries=[...new Set((siteIds?stores.filter(s=>siteIds.includes(s.id)):stores).map(s=>s.country))];
  const published=courses.results.filter(c=>c.status==='published');
  const defaults=new Map(scopeCountries.map(country=>[country,inductionFor(published,country)?.id]));
  const records:TrainingRecord[]=[];
  const visibleCourses=new Set<string>();
  const generatedAt=new Date().toISOString();
  for(const course of courses.results){
    const audience=JSON.parse(course.audience_json);
    const scos=JSON.parse(course.scos_json) as Sco[];
    if(course.status==='published' && (!siteIds || scopeCountries.some(c=>availableInCountry(course,c)||audience.countries.includes(c)) || audience.sites.some((id:string)=>siteIds.includes(id))))visibleCourses.add(course.id);
    for(const person of people.results){
      const saved=(progressMap.get(key(person.id,course.package_id!))||[]).filter(p=>scos.some(s=>s.id===p.sco_id));
      const inductionId=person.induction_enrolled?(inductionMap.get(person.id)||defaults.get(person.country)):null;
      const isAssigned=assigned.has(key(person.id,course.id)) || course.id===inductionId || (course.status==='published' && (!person.induction_enrolled || course.induction_role==='none') && matchesAudience(audience,person));
      const certificate=certificateMap.get(key(person.id,course.package_id!));
      if(!isAssigned && !saved.length && !certificate)continue;
      visibleCourses.add(course.id);
      const complete=!!certificate || scos.length>0 && scos.every(s=>saved.some(p=>p.sco_id===s.id&&['completed','passed'].includes(p.status)));
      // An old timestamp on an incomplete SCO is not a current completion.
      const completionDates=complete?saved.map(p=>p.completed_at).filter((v):v is string=>!!v):[];
      const completedAt=certificate?.completed_at||(complete&&completionDates.length===scos.length?completionDates.sort().at(-1)!:null);
      const expiresAt=certificate?certificate.expires_at:completionExpiry(completedAt,course.validity_months);
      records.push({learnerId:person.id,courseId:course.id,status:complete?(expiresAt&&expiresAt<=generatedAt?'expired':'completed'):saved.length?'in-progress':'not-started',completedAt,expiresAt,score:scos.length===1?saved[0]?.score??null:null});
    }
  }
  for(const person of people.results){
    if(person.induction_enrolled&&!person.started_at&&!person.completed_at)continue;
    visibleCourses.add(ORIGINAL_INDUCTION);
    records.push({learnerId:person.id,courseId:ORIGINAL_INDUCTION,status:person.completed_at?'completed':person.started_at?'in-progress':'not-started',completedAt:person.completed_at,expiresAt:null,score:person.best_score===null?null:`${person.best_score}/20`});
  }
  return {
    courses:[...(visibleCourses.has(ORIGINAL_INDUCTION)?[{id:ORIGINAL_INDUCTION,title:'Safety Passport (original)',category:'Induction',language:'en',paused:false,validityMonths:null}]:[]),...courses.results.filter(c=>visibleCourses.has(c.id)).map(c=>({id:c.id,title:c.title,category:c.category||'Uncategorised',language:c.language_code,paused:c.status!=='published',validityMonths:c.validity_months}))],
    employees:people.results.map(p=>({id:p.id,name:p.name,email:p.email,country:p.country,storeId:p.store_id,storeName:storeById.get(p.store_id)?.name||p.store_id})),
    records,generatedAt,legacy:legacy.results.map(l=>({email:l.email,completedAt:l.completed_at,storeName:storeById.get(l.store_id||'')?.name||''})),
  };
}
