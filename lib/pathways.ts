import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import {activeLearnerSql} from '@/lib/account-type';
import type {PathwayEnrolment,PathwayItem} from '@/lib/pathway-types';
export function validatePathway(b:Record<string,unknown>){
 if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>150||typeof b.description!=='string'||b.description.length>2000||typeof b.award_certificate!=='boolean'||typeof b.archived!=='boolean')throw new CourseError('Check the pathway name and settings.');
 if(b.deadline_days!==null&&(!Number.isSafeInteger(b.deadline_days)||Number(b.deadline_days)<1||Number(b.deadline_days)>3650))throw new CourseError('Enter a deadline between 1 and 3650 days.');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new CourseError('Choose between 1 and 100 courses.');
 const seen=new Set<string>();
 for(const i of b.items){if(!i||typeof i.courseId!=='string'||seen.has(i.courseId)||!Number.isSafeInteger(i.stage)||i.stage<1||i.stage>100)throw new CourseError('Choose each course once and enter valid stages.');seen.add(i.courseId);}
 const stages=[...new Set((b.items as PathwayItem[]).map(i=>i.stage))].sort((a,b)=>a-b);
 return {...b,name:b.name.trim(),items:(b.items as PathwayItem[]).map(i=>({...i,stage:stages.indexOf(i.stage)+1}))};
}
export async function pathwayEnrolments(learnerId:string|null,siteIds:string[]|null=null){
 return (await db().prepare(`SELECT e.*,l.name AS learner_name,l.email,l.workday_id,l.store_id,l.country,
 (SELECT jsonb_agg(jsonb_build_object('courseId',i.course_id,'title',i.title,'stage',i.stage,'completedAt',i.completed_at,
 'startedAt',h.started_at,'awaitingAssessment',h.assessor_required AND h.theory_completed_at IS NOT NULL AND h.completed_at IS NULL,
 'locked',NOT pathway_course_unlocked(e.learner_id,i.course_id),'available',c.status='published',
 'expired',EXISTS(SELECT 1 FROM certificates cert WHERE cert.assignment_id=i.assignment_id AND cert.cancelled_at IS NULL AND cert.expires_at::timestamptz<=now())) ORDER BY i.stage,i.position)
 FROM pathway_enrolment_courses i JOIN assignment_history h ON h.id=i.assignment_id JOIN courses c ON c.id=i.course_id WHERE i.enrolment_id=e.id) AS courses
 FROM pathway_enrolments e JOIN learners l ON l.id=e.learner_id WHERE ${activeLearnerSql()}
 AND (?::text IS NULL OR e.learner_id=?) AND (?::text[] IS NULL OR l.store_id=ANY(?::text[])) ORDER BY e.assigned_at DESC,e.id`)
 .bind(learnerId,learnerId,siteIds,siteIds).all<PathwayEnrolment>()).results;
}
export async function pathwayUnlocked(learnerId:string,courseId:string){return !!(await db().prepare('SELECT pathway_course_unlocked(?,?) AS unlocked').bind(learnerId,courseId).first<{unlocked:boolean}>())?.unlocked;}

export async function validatePathwayRule(input:unknown){
 const r=input as import('./pathway-types').PathwayRule;
 if(!r||typeof r.enabled!=='boolean'||!['all','countries','sites'].includes(r.scope)||!Array.isArray(r.countries)||!Array.isArray(r.sites)||r.countries.length>100||r.sites.length>10000||[...r.countries,...r.sites].some(v=>typeof v!=='string'))throw new CourseError('Check the automatic assignment rule.');
 for(const date of [r.startedFrom,r.startedTo])if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new CourseError('Choose a valid start-date range.');
 if(r.startedFrom&&r.startedTo&&r.startedFrom>r.startedTo)throw new CourseError('Choose a valid start-date range.');
 const {storeDirectory}=await import('@/lib/store-directory');const stores=await storeDirectory(false);
 if(r.enabled&&(r.scope==='countries'&&r.countries.some(c=>!stores.some(s=>s.country===c))||r.scope==='sites'&&r.sites.some(id=>!stores.some(s=>s.id===id))))throw new CourseError('Choose active countries and stores.');
 if(r.enabled&&(r.scope==='countries'&&!r.countries.length||r.scope==='sites'&&!r.sites.length))throw new CourseError('Choose at least one country or store.');
 return {enabled:r.enabled,scope:r.scope,countries:r.scope==='countries'?[...new Set(r.countries)]:[],sites:r.scope==='sites'?[...new Set(r.sites)]:[],startedFrom:r.startedFrom,startedTo:r.startedTo};
}
