import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
export type AccountingPeriod={id:string;yearLabel:string;number:number;startsOn:string;endsOn:string;state:'complete'|'current'|'future'};
export type PeriodRow={storeId:string;storeCode:string|null;storeName:string;country:string;active:boolean;assignments:number;refunds:number;net:number;completed:number;nonCompletions:number;removed:number;opening:number;topups:number;closing:number;currentBalance:number;valueCents?:number};
export type PeriodReport={period:AccountingPeriod;periods:AccountingPeriod[];rows:PeriodRow[];countries:(PeriodRow&{stores:number})[];totals:PeriodRow&{stores:number};platformAdmin:boolean;generatedAt:string;currentRateCents?:number};
export async function accountingPeriods(){return (await db().prepare(`SELECT id,year_label AS "yearLabel",period_number AS number,starts_on::text AS "startsOn",ends_on::text AS "endsOn",
 CASE WHEN ends_on<(now() AT TIME ZONE 'Europe/London')::date THEN 'complete' WHEN starts_on>(now() AT TIME ZONE 'Europe/London')::date THEN 'future' ELSE 'current' END AS state FROM accounting_periods ORDER BY starts_on DESC`).all<AccountingPeriod>()).results;}
export async function periodReport(storeIds:string[]|null,periodId:string|null,platformAdmin:boolean):Promise<PeriodReport>{
 const periods=await accountingPeriods();
 const period=periodId?periods.find(p=>p.id===periodId):periods.find(p=>p.state==='complete')||periods.find(p=>p.state==='current');
 if(!period)throw new CourseError('Choose an accounting period.');
 const {results:rows}=await db().prepare(`WITH bounds AS (SELECT starts_on::timestamp AT TIME ZONE 'Europe/London' AS start_at,
  (ends_on+1)::timestamp AT TIME ZONE 'Europe/London' AS end_at FROM accounting_periods WHERE id=?),
 events AS (SELECT e.store_id,
  count(*) FILTER(WHERE e.kind='assignment' AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at)::int AS assignments,
  count(*) FILTER(WHERE e.kind='refund' AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at)::int AS refunds,
  COALESCE(sum(e.credits) FILTER(WHERE e.recorded_at<b.start_at),0)::int AS opening,
  COALESCE(sum(e.credits) FILTER(WHERE e.kind IN ('opening','period_topup','manual_topup') AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at),0)::int AS topups,
  COALESCE(sum(e.credits) FILTER(WHERE e.recorded_at<b.end_at),0)::int AS closing
  ${platformAdmin?",COALESCE(sum(e.value_cents) FILTER(WHERE e.recorded_at>=b.start_at AND e.recorded_at<b.end_at),0)::int AS value_cents":''}
  FROM credit_ledger e CROSS JOIN bounds b GROUP BY e.store_id),
 evidence AS (SELECT h.store_id,count(*) FILTER(WHERE h.billed AND h.assigned_at>=b.start_at AND h.assigned_at<b.end_at AND h.completed_at<b.end_at)::int AS completed,
  count(*) FILTER(WHERE h.cancelled_at>=b.start_at AND h.cancelled_at<b.end_at)::int AS removed
  FROM assignment_history h CROSS JOIN bounds b GROUP BY h.store_id)
 SELECT a.store_id AS "storeId",a.store_code AS "storeCode",a.store_name AS "storeName",a.country,a.active,a.balance AS "currentBalance",
 COALESCE(e.assignments,0) AS assignments,COALESCE(e.refunds,0) AS refunds,COALESCE(e.assignments,0)-COALESCE(e.refunds,0) AS net,
 COALESCE(h.completed,0) AS completed,COALESCE(e.assignments,0)-COALESCE(h.completed,0) AS "nonCompletions",COALESCE(h.removed,0) AS removed,
 COALESCE(e.opening,0) AS opening,COALESCE(e.topups,0) AS topups,COALESCE(e.closing,0) AS closing
 ${platformAdmin?',COALESCE(e.value_cents,0) AS "valueCents"':''}
 FROM store_credit_accounts a LEFT JOIN events e ON e.store_id=a.store_id LEFT JOIN evidence h ON h.store_id=a.store_id
 WHERE (?::text[] IS NULL OR a.store_id=ANY(?::text[])) ORDER BY a.country,a.store_name,a.store_id`).bind(period.id,storeIds,storeIds).all<PeriodRow>();
 const aggregate=(items:PeriodRow[],country='')=>{
  const r:PeriodRow&{stores:number}={storeId:'',storeCode:null,storeName:'',country,active:true,stores:items.length,assignments:0,refunds:0,net:0,completed:0,nonCompletions:0,removed:0,opening:0,topups:0,closing:0,currentBalance:0,...(platformAdmin?{valueCents:0}:{})};
  for(const item of items)for(const key of ['assignments','refunds','net','completed','nonCompletions','removed','opening','topups','closing','currentBalance',...(platformAdmin?['valueCents']:[])] as const){(r as unknown as Record<string,number>)[key]+=(item as unknown as Record<string,number>)[key];}
  return r;
 };
 const rate=platformAdmin?await db().prepare('SELECT cents FROM credit_rates WHERE effective_at<=now() ORDER BY effective_at DESC LIMIT 1').first<{cents:number}>():null;
 return {period,periods,rows,countries:[...new Set(rows.map(r=>r.country))].map(c=>aggregate(rows.filter(r=>r.country===c),c)),totals:aggregate(rows),platformAdmin,generatedAt:new Date().toISOString(),...(rate?{currentRateCents:rate.cents}:{})};
}
