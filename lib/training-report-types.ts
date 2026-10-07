export const ORIGINAL_INDUCTION = 'original-safety-passport';
export type TrainingStatus = 'completed' | 'expired' | 'in-progress' | 'not-started';
export type ReportCourse = { id:string; title:string; category:string; language:string; paused:boolean; validityMonths:number|null };
export type ReportEmployee = { id:string; name:string; email:string; country:string; storeId:string; storeName:string };
export type TrainingRecord = { learnerId:string; courseId:string; status:TrainingStatus; completedAt:string|null; expiresAt:string|null; score:string|null };
export type TrainingReport = {
  courses:ReportCourse[]; employees:ReportEmployee[]; records:TrainingRecord[];
  generatedAt:string; legacy:{email:string;completedAt:string|null;storeName:string}[];
};
export const statusLabels:Record<TrainingStatus,string> = {completed:'Completed',expired:'Expired','in-progress':'In progress','not-started':'Not started'};
// Clamp to the last day of the expiry month (31 January + 1 month = 28/29 February).
export function completionExpiry(completedAt:string|null, months:number|null):string|null {
  if (!completedAt || !months) return null;
  const date=new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));return date.toISOString();
}
