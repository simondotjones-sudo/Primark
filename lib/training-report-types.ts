export const ORIGINAL_INDUCTION = 'original-safety-passport';
export type TrainingStatus = 'exempt' | 'recognised' | 'completed' | 'expired' | 'in-progress' | 'not-started';
export type ReportCourse = { id:string; title:string; category:string; language:string; paused:boolean; validityMonths:number|null };
export type ReportEmployee = { id:string; name:string; email:string; workdayId:string|null; archivedAt:string|null; country:string; storeId:string; storeName:string };
export type TrainingRecord = { learningSeconds:number|null; dueAt?:string|null;replacedByRefresher?:boolean; learnerId:string; courseId:string; status:TrainingStatus; completedAt:string|null; expiresAt:string|null; score:string|null };
export type TrainingReport = {
  courses:ReportCourse[]; employees:ReportEmployee[]; records:TrainingRecord[];
  generatedAt:string; legacy:{email:string;completedAt:string|null;storeName:string}[];
};
export type ReportSelection = {category:string;courseId:string};
export type TrainingOverview = {
  courses:ReportCourse[]; generatedAt:string;
  metrics:{assessed:number;compliant:number;withinDeadline:number;excludeWithinDeadline:boolean;employees:number;records:number;inProgress:number;expired:number;assigned:number;completed:number;compliance:number|null;expiringPeople:number};
  completions:{month:string;count:number}[];
  groups:{completedCourses:number;assessed:number;withinDeadline:number;country:string;storeId:string;total:number;completed:number;expired:number}[];
  legacy:{month:string|null;count:number}[];
};
export type TrainingActivity = Pick<TrainingReport,'courses'|'employees'|'records'|'generatedAt'> & {page:number;pageSize:number;hasMore:boolean};
export type ExpiringCertificates = TrainingActivity & {totalPeople:number};
// Course-reported time for the current attempt; absent/zero timing is unknown.
// Use elapsed hours rather than a clock so durations over 24 hours do not wrap.
export function formatLearningTime(seconds:number|null|undefined):string {
  if(seconds==null||!Number.isFinite(seconds)||seconds<=0)return '—';
  const total=Math.max(1,Math.round(seconds));
  return [Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(v=>String(v).padStart(2,'0')).join(':');
}
export const statusLabels:Record<TrainingStatus,string> = {exempt:'Exempt',recognised:'Prior learning recognised',completed:'Completed',expired:'Expired','in-progress':'In progress','not-started':'Not started'};
// Clamp to the last day of the expiry month (31 January + 1 month = 28/29 February).
export function completionExpiry(completedAt:string|null, months:number|null):string|null {
  if (!completedAt || !months) return null;
  const date=new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));return date.toISOString();
}

