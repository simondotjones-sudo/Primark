import {db,inTransaction} from './database';
import {CourseError} from './course-admin';
import {requireEmailAdmin} from './email-notifications';
import {requireFeature} from './features';
import type {UserAdministrator} from './user-administration';
import {storeDirectory} from './store-directory';
import {scheduledTrainingSummary} from './training-report';
import type {EmailPayload} from './email-types';
export type ReportKind='manager_digest'|'country_digest';
export type ReportSchedule={kind:ReportKind;weekday:number;monthday:number;hour:number;timezone:string;revision:number};
export const reportFeature={manager_digest:'weekly_store_reports',country_digest:'monthly_country_reports'} as const;
export async function reportSchedules(){return (await db().prepare('SELECT kind,weekday,monthday,hour,timezone,revision FROM scheduled_report_settings ORDER BY kind').all<ReportSchedule>()).results;}
export async function saveReportSchedule(actor:UserAdministrator,b:Record<string,unknown>){
 requireEmailAdmin(actor);
 if(b.kind!=='manager_digest'&&b.kind!=='country_digest')throw new CourseError('Choose a scheduled report.');
 await requireFeature(reportFeature[b.kind]);
 const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
 if(!integer(b.weekday,1,7)||!integer(b.monthday,1,28)||!integer(b.hour,0,23)||!integer(b.revision,1,2147483647)||typeof b.timezone!=='string'||b.timezone.length>100)throw new CourseError('Check the report schedule.');
 if(!await db().prepare('SELECT name FROM pg_timezone_names WHERE name=?').bind(b.timezone).first())throw new CourseError('Choose a valid timezone.');
 await inTransaction(async client=>{
  if(actor.id&&!((await client.query(`SELECT l.id FROM learners l WHERE l.id=$1 AND l.archived_at IS NULL AND (EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='organisation')) FOR UPDATE`,[actor.id])).rows.length))throw new CourseError('Organisation admin access is required.',403);
  if(!(await client.query('SELECT feature_enabled($1) enabled',[reportFeature[b.kind as ReportKind]])).rows[0].enabled)throw new CourseError('This feature is switched off in Settings.',403);
  const {rows:[old]}=await client.query('SELECT * FROM scheduled_report_settings WHERE kind=$1 FOR UPDATE',[b.kind]);
  if(old.revision!==b.revision)throw new CourseError('These settings changed. Reload before saving.',409);
  await client.query('UPDATE scheduled_report_settings SET weekday=$2,monthday=$3,hour=$4,timezone=$5,revision=revision+1,updated_at=now(),updated_by=$6 WHERE kind=$1',[b.kind,b.weekday,b.monthday,b.hour,b.timezone,actor.email]);
  // Queued jobs retain their unique period keys and are revalidated against the new schedule.
  const details=JSON.stringify({kind:b.kind,weekday:b.weekday,monthday:b.monthday,hour:b.hour,timezone:b.timezone});
  await client.query("INSERT INTO email_audit(actor,action,details) VALUES($1,'report_schedule',$2)",[actor.email,details]);
  await client.query("INSERT INTO audit_events(actor,entity,entity_id,action,previous_state,next_state) VALUES($1,'scheduled_report',$2,'schedule_updated',$3,$4)",[actor.email,b.kind,JSON.stringify(old),details]);
 });
 return reportSchedules();
}
export async function buildScheduledReport(kind:ReportKind,payload:EmailPayload){
 const stores=await storeDirectory(false),scope=payload.reportScope;
 const selected=stores.filter(s=>kind==='manager_digest'?s.id===scope:s.country===scope);
 if(!selected.length)throw new CourseError('This report scope is no longer available.',409);
 return {...payload,store:kind==='manager_digest'?selected[0].name:scope,report:await scheduledTrainingSummary(selected.map(s=>s.id),kind==='manager_digest')};
}
