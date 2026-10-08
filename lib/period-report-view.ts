import type {PeriodReport,PeriodRow} from '@/lib/period-report';

export type PeriodViewOptions={search?:string;zeroOnly?:boolean;sort?:PeriodReport['sort']};

export function totalPeriodRows(items:PeriodRow[],platformAdmin:boolean,country=''){
 const total:PeriodRow&{stores:number}={storeId:'',storeCode:null,storeName:'',country,active:true,stores:items.length,assignments:0,refunds:0,net:0,completed:0,nonCompletions:0,removed:0,opening:0,topups:0,closing:0,currentBalance:0,lastAssignedAt:null,daysSinceAssignment:null,...(platformAdmin?{valueCents:0}:{})};
 for(const item of items)for(const key of ['assignments','refunds','net','completed','nonCompletions','removed','opening','topups','closing','currentBalance',...(platformAdmin?['valueCents']:[])] as const){(total as unknown as Record<string,number>)[key]+=(item as unknown as Record<string,number>)[key];}
 return total;
}

// Shared by the screen and Excel export so filters, ordering and totals agree.
export function periodReportView(report:PeriodReport,options:PeriodViewOptions={}):PeriodReport{
 const search=(options.search||'').trim().toLowerCase(),sort=options.sort||'store';
 const rows=report.rows.filter(row=>(!options.zeroOnly||row.assignments===0)&&(!search||[row.country,row.storeCode||'',row.storeName].join(' ').toLowerCase().includes(search)));
 rows.sort((a,b)=>{
  if(sort==='assignments'&&a.assignments!==b.assignments)return b.assignments-a.assignments;
  if(sort==='inactive'){
   // Unknown history is distinct from a measured duration, and appears last.
   if(a.daysSinceAssignment===null&&b.daysSinceAssignment!==null)return 1;
   if(b.daysSinceAssignment===null&&a.daysSinceAssignment!==null)return -1;
   const difference=(b.daysSinceAssignment??0)-(a.daysSinceAssignment??0);if(difference)return difference;
  }
  return a.country.localeCompare(b.country)||a.storeName.localeCompare(b.storeName)||a.storeId.localeCompare(b.storeId);
 });
 return {...report,rows,sort,countries:[...new Set(rows.map(row=>row.country))].map(country=>totalPeriodRows(rows.filter(row=>row.country===country),report.platformAdmin,country)),totals:totalPeriodRows(rows,report.platformAdmin)};
}
