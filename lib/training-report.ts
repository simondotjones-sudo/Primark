import {organisationSettings} from '@/lib/organisation-settings';
import { learnerOnlySql } from '@/lib/account-type';
import { db } from '@/lib/database';
import { availableInCountry, inductionFor } from '@/lib/course-catalogue';
import type { Course } from '@/lib/course-types';
import { storeDirectory } from '@/lib/store-directory';
import { ORIGINAL_INDUCTION, type ExpiringCertificates, type ReportCourse, type ReportEmployee, type ReportSelection, type TrainingActivity, type TrainingOverview, type TrainingRecord, type TrainingReport } from '@/lib/training-report-types';

const allCourses:ReportSelection={category:'all',courseId:'all'};
const PAGE_SIZE=25;
type ReadyCourse=Course&{scos_json:string};
type PersonRow={id:string;name:string;email:string;workday_id:string|null;archived_at:string|null;country:string;store_id:string};
function person(row:PersonRow,stores:Awaited<ReturnType<typeof storeDirectory>>):ReportEmployee {
  return {id:row.id,name:row.name,email:row.email,workdayId:row.workday_id,archivedAt:row.archived_at,country:row.country,storeId:row.store_id,storeName:stores.find(s=>s.id===row.store_id)?.name||row.store_id};
}

// Shared record rules for summaries, search, the store matrix and explicit exports.
// Scope/search are applied to people before joining assignments or progress. No
// SCORM data_json, session tokens or certificate tokens are read for reporting.
async function reportQuery(siteIds:string[]|null,selection=allCourses,search='') {
  const [stores,{results:courses}]=await Promise.all([storeDirectory(),db().prepare("SELECT c.*,p.scos_json FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE p.status='ready' ORDER BY c.title,c.id").all<ReadyCourse>()]);
  const countries=[...new Set((siteIds?stores.filter(s=>siteIds.includes(s.id)):stores).map(s=>s.country))];
  const defaults=countries.map(country=>({country,course_id:inductionFor(courses,country)?.id||null}));
  const args:unknown[]=[siteIds,siteIds,search,search,search,search,JSON.stringify(defaults)];
  const cte=`WITH people AS MATERIALIZED (
    SELECT l.id,l.name,l.email,l.workday_id,l.archived_at,l.country,l.store_id,l.induction_enrolled,l.started_at,l.completed_at,l.best_score
    FROM learners l WHERE ${learnerOnlySql()} AND (?::text[] IS NULL OR l.store_id=ANY(?::text[]))
      AND (?='' OR strpos(lower(l.name),lower(?))>0 OR strpos(lower(l.email),lower(?))>0 OR strpos(lower(COALESCE(l.workday_id,'')),lower(?))>0)
  ), defaults AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS d(country text,course_id text)),
  ready AS MATERIALIZED (
    SELECT c.*,p.scos_json::jsonb AS scos,jsonb_array_length(p.scos_json::jsonb) AS sco_count,c.audience_json::jsonb AS audience
    FROM courses c JOIN course_packages p ON p.id=c.package_id WHERE p.status='ready'
  ), saved AS MATERIALIZED (
    SELECT s.learner_id,c.id AS course_id,count(*) AS saved_count,
      count(*) FILTER (WHERE s.status IN ('completed','passed')) AS done_count,
      count(s.completed_at) AS date_count,max(s.completed_at) AS completed_at,max(s.score) AS score,
      NULLIF(sum(GREATEST(s.total_centiseconds,0)),0)::double precision / 100 AS learning_seconds
    FROM scorm_progress s JOIN people l ON l.id=s.learner_id JOIN course_packages pack ON pack.id=s.package_id JOIN ready c ON c.id=pack.course_id
    LEFT JOIN course_assignments ca ON ca.learner_id=l.id AND ca.course_id=c.id LEFT JOIN assignment_history ah ON ah.id=ca.history_id
    WHERE s.package_id=COALESCE(ah.package_id,c.package_id) AND EXISTS (SELECT 1 FROM jsonb_array_elements(pack.scos_json::jsonb) item WHERE item->>'id'=s.sco_id)
    GROUP BY s.learner_id,c.id
  ), candidates AS (
    SELECT l.id AS learner_id,c.id AS course_id FROM people l JOIN course_assignments a ON a.learner_id=l.id JOIN ready c ON c.id=a.course_id
    UNION
    SELECT l.id,c.id FROM people l LEFT JOIN learner_inductions i ON i.learner_id=l.id LEFT JOIN defaults d ON d.country=l.country
      JOIN ready c ON c.id=COALESCE(i.course_id,d.course_id) WHERE l.induction_enrolled AND NOT EXISTS(SELECT 1 FROM assignment_exclusions x WHERE x.learner_id=l.id AND x.course_id=c.id)
    UNION
    SELECT l.id,c.id FROM people l JOIN ready c ON c.status='published' AND (NOT l.induction_enrolled OR c.induction_role='none')
      AND NOT EXISTS(SELECT 1 FROM assignment_exclusions x WHERE x.learner_id=l.id AND x.course_id=c.id)
      AND (jsonb_exists(c.audience->'countries',l.country) OR jsonb_exists(c.audience->'sites',l.store_id) OR jsonb_exists(c.audience->'users',l.id))
    UNION SELECT learner_id,course_id FROM saved
    UNION SELECT l.id,c.id FROM people l JOIN certificates cert ON cert.learner_id=l.id AND cert.archived_at IS NULL AND cert.cancelled_at IS NULL JOIN ready c ON c.id=cert.course_id
  ), evidence AS (
    SELECT a.learner_id,a.course_id,c.validity_months,c.sco_count,s.saved_count,s.score,s.learning_seconds,
      attempt.score AS quiz_score,h.due_at,COALESCE(previous.expires_at,source.expires_at) AS previous_expiry,
      EXISTS(SELECT 1 FROM course_refresher_assignments replacement
        JOIN certificates source_cert ON source_cert.token=replacement.certificate_token
        JOIN course_assignments target ON target.learner_id=source_cert.learner_id AND target.course_id=replacement.refresher_course_id
        WHERE source_cert.learner_id=a.learner_id AND source_cert.course_id=a.course_id AND source_cert.archived_at IS NULL AND source_cert.cancelled_at IS NULL) AS replaced_by_refresher,
      (cert.package_id IS NOT NULL OR (NOT COALESCE(h.assessor_required,false) AND c.sco_count>0 AND s.done_count=c.sco_count AND (h.quiz_json IS NULL OR EXISTS(SELECT 1 FROM course_quiz_attempts q WHERE q.assignment_id=h.id AND q.passed)))) AS complete,
      COALESCE(cert.completed_at,CASE WHEN NOT COALESCE(h.assessor_required,false) AND s.done_count=c.sco_count AND s.date_count=c.sco_count AND c.sco_count>0 AND (h.quiz_json IS NULL OR EXISTS(SELECT 1 FROM course_quiz_attempts q WHERE q.assignment_id=h.id AND q.passed)) THEN s.completed_at END) AS completed_at,
      cert.package_id IS NOT NULL AS certified,cert.expires_at AS certificate_expiry
    FROM candidates a JOIN ready catalogue ON catalogue.id=a.course_id
    LEFT JOIN course_assignments current_assignment ON current_assignment.learner_id=a.learner_id AND current_assignment.course_id=a.course_id
    LEFT JOIN assignment_history h ON h.id=current_assignment.history_id
    JOIN course_packages assigned_package ON assigned_package.id=COALESCE(h.package_id,catalogue.package_id)
    CROSS JOIN LATERAL (SELECT catalogue.id, (CASE WHEN h.course_snapshot IS NOT NULL THEN (h.course_snapshot->>'validity_months')::integer ELSE catalogue.validity_months END) AS validity_months,
      jsonb_array_length(assigned_package.scos_json::jsonb) AS sco_count,assigned_package.id AS package_id) c
    LEFT JOIN LATERAL (SELECT cert.expires_at::timestamptz FROM certificates cert WHERE cert.assignment_id=h.previous_id AND cert.cancelled_at IS NULL ORDER BY cert.completed_at DESC LIMIT 1) previous ON true
    LEFT JOIN LATERAL (SELECT cert.expires_at::timestamptz FROM course_refresher_assignments link JOIN certificates cert ON cert.token=link.certificate_token
      WHERE link.assignment_id=h.id AND cert.cancelled_at IS NULL ORDER BY cert.expires_at LIMIT 1) source ON true
    LEFT JOIN LATERAL (SELECT to_char(floor(1000.0*q.correct_count/q.question_count)/10,'FM990.0')||'%' AS score
      FROM course_quiz_attempts q WHERE q.assignment_id=h.id ORDER BY q.passed DESC,q.submitted_at DESC,q.id LIMIT 1) attempt ON h.quiz_json IS NOT NULL
    LEFT JOIN saved s ON s.learner_id=a.learner_id AND s.course_id=a.course_id
    LEFT JOIN certificates cert ON cert.learner_id=a.learner_id AND cert.package_id=c.package_id AND cert.archived_at IS NULL AND cert.cancelled_at IS NULL
  ), dated AS (
    SELECT e.*,CASE WHEN certified THEN certificate_expiry WHEN completed_at IS NOT NULL AND validity_months IS NOT NULL THEN
      to_char((completed_at::timestamptz AT TIME ZONE 'UTC')+make_interval(months=>validity_months),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS expires_at FROM evidence e
  ), all_records AS MATERIALIZED (
    SELECT learner_id AS "learnerId",course_id AS "courseId",
      CASE WHEN complete THEN CASE WHEN expires_at<=? THEN 'expired' ELSE 'completed' END WHEN saved_count>0 THEN 'in-progress' ELSE 'not-started' END AS status,
      completed_at AS "completedAt",expires_at AS "expiresAt",COALESCE(quiz_score,CASE WHEN sco_count=1 THEN score END) AS score,
      to_char(LEAST(due_at,previous_expiry) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "dueAt",to_char(previous_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "coveredUntil",replaced_by_refresher AS "replacedByRefresher",learning_seconds AS "learningSeconds" FROM dated
    UNION ALL
    SELECT id,?::text,CASE WHEN completed_at IS NOT NULL THEN 'completed' WHEN started_at IS NOT NULL THEN 'in-progress' ELSE 'not-started' END,
      completed_at,NULL,CASE WHEN best_score IS NOT NULL THEN best_score::text||'/20' END,NULL::text,NULL::text,false,NULL::double precision FROM people
      WHERE NOT induction_enrolled OR started_at IS NOT NULL OR completed_at IS NOT NULL
  ), records AS (
    SELECT r.* FROM all_records r LEFT JOIN ready c ON c.id=r."courseId"
    WHERE (?='all' OR CASE WHEN c.id IS NULL THEN 'Induction' ELSE COALESCE(NULLIF(c.category,''),'Uncategorised') END=?) AND (?='all' OR r."courseId"=?)
  ), active_records AS MATERIALIZED (
    SELECT r.* FROM records r JOIN people l ON l.id=r."learnerId" WHERE l.archived_at IS NULL
  ), compliance_records AS MATERIALIZED (
    SELECT r.*,status='completed' OR (status<>'expired' AND COALESCE("coveredUntil"::timestamptz>clock.at,false)) AS compliant,
      status NOT IN ('completed','expired') AND COALESCE("dueAt"::timestamptz>clock.at,false)
      AND NOT COALESCE("coveredUntil"::timestamptz>clock.at,false) AS within_deadline
    FROM active_records r CROSS JOIN (SELECT ?::timestamptz AS at) clock WHERE NOT "replacedByRefresher"
  ), expiring_records AS MATERIALIZED (
    SELECT * FROM active_records WHERE status='completed' AND "expiresAt"::timestamptz>?::timestamptz AND "expiresAt"::timestamptz<=?::timestamptz
  )`;
  const generatedAt=new Date().toISOString();
  // All caller values are bound.
  args.push(generatedAt,ORIGINAL_INDUCTION,selection.category,selection.category,selection.courseId,selection.courseId,
    generatedAt,generatedAt,new Date(Date.parse(generatedAt)+30*86400000).toISOString());
  const run=<T,>(sql:string,extra:unknown[]=[])=>db().prepare(cte+' '+sql).bind(...args,...extra).all<T>();
  function visibleCourses(ids:string[]):ReportCourse[]{
    const visible=new Set(ids);
    return [...(visible.has(ORIGINAL_INDUCTION)?[{id:ORIGINAL_INDUCTION,title:'Safety Passport (original)',category:'Induction',language:'en',paused:false,validityMonths:null}]:[]),...courses.filter(c=>{
      const audience=JSON.parse(c.audience_json);
      return visible.has(c.id)||(c.status==='published'&&(!siteIds||countries.some(country=>availableInCountry(c,country)||audience.countries.includes(country))||audience.sites.some((id:string)=>siteIds.includes(id))));
    }).map(c=>({id:c.id,title:c.title,category:c.category||'Uncategorised',language:c.language_code,paused:c.status!=='published',validityMonths:c.validity_months}))];
  }
  return {run,stores,generatedAt,visibleCourses};
}

function legacyQuery(siteIds:string[]|null){
  return {sql:`FROM legacy_completions c LEFT JOIN learners l ON l.email=c.email WHERE c.completed=1 AND (l.id IS NULL OR (${learnerOnlySql()})) AND (?::text[] IS NULL OR COALESCE(l.store_id,c.store_id)=ANY(?::text[]))`,args:[siteIds,siteIds]};
}

export async function trainingOverview(siteIds:string[]|null,selection=allCourses):Promise<TrainingOverview>{
  const q=await reportQuery(siteIds,selection),legacy=legacyQuery(siteIds),settings=await organisationSettings();
  const assessed=settings.exclude_within_deadline?'NOT within_deadline':'true';
  const [{results:[row]},{results:historical}]=await Promise.all([
    q.run<{metrics:TrainingOverview['metrics'];completions:TrainingOverview['completions'];groups:TrainingOverview['groups'];courseIds:string[]}>(`SELECT
      (SELECT json_build_object('employees',count(DISTINCT "learnerId"),'records',count(*),'inProgress',count(*) FILTER(WHERE status='in-progress'),'expired',count(*) FILTER(WHERE status='expired'),
        'assigned',(SELECT count(*) FROM active_records),'completed',(SELECT count(*) FROM active_records WHERE status='completed'),
        'assessed',(SELECT count(*) FROM compliance_records WHERE ${assessed}),
        'compliant',(SELECT count(*) FROM compliance_records WHERE compliant),
        'withinDeadline',(SELECT count(*) FROM compliance_records WHERE within_deadline),
        'excludeWithinDeadline',${settings.exclude_within_deadline},
        'compliance',(SELECT floor(1000.0*count(*) FILTER(WHERE compliant)/NULLIF(count(*) FILTER(WHERE ${assessed}),0))/10 FROM compliance_records),
        'expiringPeople',(SELECT count(DISTINCT "learnerId") FROM expiring_records)) FROM records) AS metrics,
      COALESCE((SELECT json_agg(b) FROM (SELECT substring("completedAt",1,7) AS month,count(*)::int AS count FROM records WHERE "completedAt" IS NOT NULL GROUP BY 1 ORDER BY 1) b),'[]') AS completions,
      COALESCE((SELECT json_agg(g) FROM (SELECT l.country,l.store_id AS "storeId",count(*)::int AS total,count(*) FILTER(WHERE r.compliant)::int AS completed,count(*) FILTER(WHERE r.status='expired')::int AS expired,
        count(*) FILTER(WHERE ${assessed})::int AS assessed,count(*) FILTER(WHERE within_deadline)::int AS "withinDeadline"
        FROM compliance_records r JOIN people l ON l.id=r."learnerId" GROUP BY l.country,l.store_id) g),'[]') AS groups,
      COALESCE((SELECT json_agg(DISTINCT "courseId") FROM all_records),'[]') AS "courseIds"`),
    db().prepare(`SELECT substring(c.completed_at,1,7) AS month,count(*)::int AS count ${legacy.sql} GROUP BY 1`).bind(...legacy.args).all<TrainingOverview['legacy'][number]>(),
  ]);
  return {courses:q.visibleCourses(row.courseIds),generatedAt:q.generatedAt,metrics:row.metrics,completions:row.completions,groups:row.groups,legacy:historical};
}

export async function trainingActivity(siteIds:string[]|null,selection:ReportSelection,search:string,page:number):Promise<TrainingActivity>{
  if(!search)return {courses:[],employees:[],records:[],generatedAt:new Date().toISOString(),page:1,pageSize:PAGE_SIZE,hasMore:false};
  const q=await reportQuery(siteIds,selection,search);
  const {results}=await q.run<TrainingRecord&PersonRow>(`SELECT r.*,l.* FROM records r JOIN people l ON l.id=r."learnerId" ORDER BY lower(l.name),l.id,r."courseId" LIMIT ? OFFSET ?`,[PAGE_SIZE+1,(page-1)*PAGE_SIZE]);
  const rows=results.slice(0,PAGE_SIZE),ids=new Set(rows.map(r=>r.courseId));
  return {courses:q.visibleCourses([...ids]).filter(c=>ids.has(c.id)),employees:[...new Map(rows.map(r=>[r.id,person(r,q.stores)])).values()],records:rows.map(r=>({learnerId:r.learnerId,courseId:r.courseId,status:r.status,completedAt:r.completedAt,expiresAt:r.expiresAt,score:r.score,learningSeconds:r.learningSeconds,dueAt:r.dueAt,replacedByRefresher:r.replacedByRefresher})),generatedAt:q.generatedAt,page,pageSize:PAGE_SIZE,hasMore:results.length>PAGE_SIZE};
}

// Paginate people, keeping all their matching certificates together. The overview
// count and this drill-down share the same active-record and expiry-window rules.
export async function expiringCertificates(siteIds:string[]|null,selection:ReportSelection,search:string,page:number):Promise<ExpiringCertificates>{
  const q=await reportQuery(siteIds,selection,search);
  const {results:[data]}=await q.run<{employees:PersonRow[];records:TrainingRecord[];totalPeople:number}>(`, expiring_people AS (
    SELECT "learnerId",min("expiresAt"::timestamptz) AS first_expiry FROM expiring_records GROUP BY "learnerId"
  ), page_people AS (
    SELECT l.*,e.first_expiry FROM expiring_people e JOIN people l ON l.id=e."learnerId"
    ORDER BY e.first_expiry,lower(l.name),l.id LIMIT ? OFFSET ?
  ) SELECT
    COALESCE((SELECT json_agg(p ORDER BY p.first_expiry,lower(p.name),p.id) FROM page_people p),'[]') AS employees,
    COALESCE((SELECT json_agg(r ORDER BY r."expiresAt"::timestamptz,r."courseId") FROM expiring_records r JOIN page_people p ON p.id=r."learnerId"),'[]') AS records,
    (SELECT count(*)::int FROM expiring_people) AS "totalPeople"`,[PAGE_SIZE,(page-1)*PAGE_SIZE]);
  const ids=[...new Set(data.records.map(r=>r.courseId))];
  return {courses:q.visibleCourses(ids).filter(c=>ids.includes(c.id)),employees:data.employees.map(p=>person(p,q.stores)),records:data.records,
    generatedAt:q.generatedAt,page,pageSize:PAGE_SIZE,hasMore:page*PAGE_SIZE<data.totalPeople,totalPeople:data.totalPeople};
}

// Full rows are fetched only for the selected store matrix or an explicit export.
export async function trainingReport(siteIds:string[]|null,selection=allCourses,search=''):Promise<TrainingReport>{
  const q=await reportQuery(siteIds,selection,search),legacy=legacyQuery(siteIds);
  const [{results:[data]},{results:historical}]=await Promise.all([
    q.run<{employees:PersonRow[];records:TrainingRecord[];courseIds:string[]}>(`SELECT COALESCE((SELECT json_agg(p ORDER BY p.name,p.id) FROM people p),'[]') AS employees,
      COALESCE((SELECT json_agg(r ORDER BY "courseId","learnerId") FROM records r),'[]') AS records,
      COALESCE((SELECT json_agg(DISTINCT "courseId") FROM all_records),'[]') AS "courseIds"`),
    db().prepare(`SELECT c.email,c.completed_at,COALESCE(l.store_id,c.store_id) AS store_id ${legacy.sql}`).bind(...legacy.args).all<{email:string;completed_at:string|null;store_id:string|null}>(),
  ]);
  return {courses:q.visibleCourses(data.courseIds),employees:data.employees.map(p=>person(p,q.stores)),records:data.records,generatedAt:q.generatedAt,legacy:historical.map(l=>({email:l.email,completedAt:l.completed_at,storeName:q.stores.find(s=>s.id===l.store_id)?.name||''}))};
}

