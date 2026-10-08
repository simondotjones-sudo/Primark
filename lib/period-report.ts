import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import {periodReportView,totalPeriodRows} from '@/lib/period-report-view';
export type AccountingPeriod={id:string;yearLabel:string;number:number;startsOn:string;endsOn:string;state:'complete'|'current'|'future'};
export type ReportingRange=AccountingPeriod&{kind:'period'|'quarter'|'fytd';firstPeriod:number;lastPeriod:number};
export type PeriodRow={storeId:string;storeCode:string|null;storeName:string;country:string;active:boolean;assignments:number;refunds:number;net:number;completed:number;nonCompletions:number;removed:number;opening:number;topups:number;closing:number;currentBalance:number;lastAssignedAt:string|null;daysSinceAssignment:number|null;valueCents?:number};
export type PeriodReport={period:ReportingRange;periods:AccountingPeriod[];ranges:ReportingRange[];asOf:string;sort:'store'|'inactive';rows:PeriodRow[];countries:(PeriodRow&{stores:number})[];totals:PeriodRow&{stores:number};platformAdmin:boolean;generatedAt:string;currentRateCents?:number};

export function reportingRanges(periods:AccountingPeriod[],today:string):ReportingRange[]{
 const state=(start:string,end:string)=>end<today?'complete' as const:start>today?'future' as const:'current' as const;
 const ranges:ReportingRange[]=periods.map(p=>({...p,state:state(p.startsOn,p.endsOn),kind:'period',firstPeriod:p.number,lastPeriod:p.number}));
 for(const year of new Set(periods.map(p=>p.yearLabel))){
  const yearPeriods=periods.filter(p=>p.yearLabel===year).sort((a,b)=>a.number-b.number),first=yearPeriods[0],last=yearPeriods.at(-1)!;
  for(const [index,[from,to]] of [[1,3],[4,6],[7,9],[10,13]].entries()){
   const start=yearPeriods.find(p=>p.number===from),end=yearPeriods.find(p=>p.number===to);
   if(start&&end)ranges.push({id:`${first.id}-Q${index+1}`,yearLabel:year,number:index+1,startsOn:start.startsOn,endsOn:end.endsOn,state:state(start.startsOn,end.endsOn),kind:'quarter',firstPeriod:from,lastPeriod:to});
  }
  // A future financial year has no year-to-date interval yet.
  if(today>=first.startsOn){const end=today<last.endsOn?today:last.endsOn;ranges.push({id:`${first.id}-FYTD`,yearLabel:year,number:0,startsOn:first.startsOn,endsOn:end,state:state(first.startsOn,last.endsOn),kind:'fytd',firstPeriod:1,lastPeriod:yearPeriods.filter(p=>p.startsOn<=end).at(-1)!.number});}
 }
 return ranges;
}
export async function accountingPeriods(){return (await db().prepare(`SELECT id,year_label AS "yearLabel",period_number AS number,starts_on::text AS "startsOn",ends_on::text AS "endsOn",
 CASE WHEN ends_on<(now() AT TIME ZONE 'Europe/London')::date THEN 'complete' WHEN starts_on>(now() AT TIME ZONE 'Europe/London')::date THEN 'future' ELSE 'current' END AS state FROM accounting_periods ORDER BY starts_on DESC`).all<AccountingPeriod>()).results;}
export async function periodReport(storeIds:string[]|null,periodId:string|null,platformAdmin:boolean,clock=new Date()):Promise<PeriodReport>{
 const periods=await accountingPeriods();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock);
 const ranges=reportingRanges(periods,today),period=periodId?ranges.find(p=>p.id===periodId):ranges.find(p=>p.kind==='period'&&p.state==='complete')||ranges.find(p=>p.kind==='period'&&p.state==='current');
 if(!period)throw new CourseError('Choose an accounting period.');
 const asOf=period.endsOn<today?period.endsOn:today;
 const {results:rows}=await db().prepare(`WITH bounds AS (SELECT ?::date::timestamp AT TIME ZONE 'Europe/London' AS start_at,
  LEAST((?::date+1)::timestamp AT TIME ZONE 'Europe/London',?::timestamptz) AS end_at,?::date AS as_of),
 events AS (SELECT e.store_id,
  count(*) FILTER(WHERE e.kind='assignment' AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at)::int AS assignments,
  count(*) FILTER(WHERE e.kind='refund' AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at)::int AS refunds,
  COALESCE(sum(e.credits) FILTER(WHERE e.recorded_at<LEAST(b.start_at,b.end_at)),0)::int AS opening,
  COALESCE(sum(e.credits) FILTER(WHERE e.kind IN ('opening','period_topup','manual_topup') AND e.recorded_at>=b.start_at AND e.recorded_at<b.end_at),0)::int AS topups,
  COALESCE(sum(e.credits) FILTER(WHERE e.recorded_at<b.end_at),0)::int AS closing
  ${platformAdmin?",COALESCE(sum(e.value_cents) FILTER(WHERE e.recorded_at>=b.start_at AND e.recorded_at<b.end_at),0)::int AS value_cents":''}
  FROM credit_ledger e CROSS JOIN bounds b GROUP BY e.store_id),
 evidence AS (SELECT h.store_id,count(*) FILTER(WHERE h.billed AND h.assigned_at>=b.start_at AND h.assigned_at<b.end_at AND h.completed_at<b.end_at)::int AS completed,
  count(*) FILTER(WHERE h.cancelled_at>=b.start_at AND h.cancelled_at<b.end_at)::int AS removed,
  max(h.assigned_at) FILTER(WHERE h.assigned_at<b.end_at) AS last_assigned_at
  FROM assignment_history h CROSS JOIN bounds b GROUP BY h.store_id)
 SELECT a.store_id AS "storeId",a.store_code AS "storeCode",a.store_name AS "storeName",a.country,a.active,a.balance AS "currentBalance",
 COALESCE(e.assignments,0) AS assignments,COALESCE(e.refunds,0) AS refunds,COALESCE(e.assignments,0)-COALESCE(e.refunds,0) AS net,
 COALESCE(h.completed,0) AS completed,COALESCE(e.assignments,0)-COALESCE(h.completed,0) AS "nonCompletions",COALESCE(h.removed,0) AS removed,
 COALESCE(e.opening,0) AS opening,COALESCE(e.topups,0) AS topups,COALESCE(e.closing,0) AS closing,
 to_char(h.last_assigned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastAssignedAt",
 (b.as_of-(h.last_assigned_at AT TIME ZONE 'Europe/London')::date)::int AS "daysSinceAssignment"
 ${platformAdmin?',COALESCE(e.value_cents,0) AS "valueCents"':''}
 FROM store_credit_accounts a CROSS JOIN bounds b LEFT JOIN events e ON e.store_id=a.store_id LEFT JOIN evidence h ON h.store_id=a.store_id
 WHERE (?::text[] IS NULL OR a.store_id=ANY(?::text[])) ORDER BY a.country,a.store_name,a.store_id`).bind(period.startsOn,period.endsOn,clock.toISOString(),asOf,storeIds,storeIds).all<PeriodRow>();
 const rate=platformAdmin?await db().prepare('SELECT cents FROM credit_rates WHERE effective_at<=now() ORDER BY effective_at DESC LIMIT 1').first<{cents:number}>():null;
 return periodReportView({period,periods,ranges,asOf,sort:'store',rows,countries:[],totals:totalPeriodRows(rows,platformAdmin),platformAdmin,generatedAt:clock.toISOString(),...(rate?{currentRateCents:rate.cents}:{})});
}
