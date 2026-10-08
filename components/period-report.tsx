'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import type {ReportFilter} from '@/lib/profile';
import type {PeriodReport as Report,PeriodRow,ReportingRange} from '@/lib/period-report';
import {periodReportView} from '@/lib/period-report-view';
import {languageLocale} from '@/lib/i18n';
import CreditSettings from '@/components/credit-settings';
import './period-report.css';
// Soft hyphens are visible only when these headings need to wrap.
const englishHeadings:Record<string,string>={'Assignments':'Assign\u00adments','Net chargeable':'Net charge\u00adable','Completions':'Comple\u00adtions','Non completions':'Non comple\u00adtions'};
export default function PeriodReporting({filter,platformAdmin}:{filter:ReportFilter;platformAdmin:boolean}){
 const {t,date,country,lang}=useLanguage();
 const [data,setData]=useState<Report|null>(null),[period,setPeriod]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[refresh,setRefresh]=useState(0),[search,setSearch]=useState('');
 const [zeroOnly,setZeroOnly]=useState(false),[sort,setSort]=useState<Report['sort']>('store');
 const view=useMemo(()=>data?periodReportView(data,{search,zeroOnly,sort}):null,[data,search,zeroOnly,sort]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setError('');
  fetch('/api/reporting/periods?'+new URLSearchParams({...filter,...(period?{period}:{})}),{cache:'no-store',signal:controller.signal})
   .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(d=>{if(!controller.signal.aborted){setData(d);setLoading(false);}})
   .catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoading(false);}});
  return()=>controller.abort();
 },[filter.role,filter.country,filter.site,period,refresh]);
 async function download(){setExporting(true);setError('');try{
  const r=await fetch('/api/reporting/periods?'+new URLSearchParams({...filter,period:data!.period.id,search,zeroOnly:zeroOnly?'1':'0',sort,export:'xlsx'}),{cache:'no-store'});
  if(!r.ok)throw new Error((await r.json()).error);const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=`primark-${data!.period.id}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setExporting(false);}}
 const money=(cents:number)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
 const rangeLabel=(range:ReportingRange)=>range.kind==='fytd'?t('Financial Year to Date'):range.kind==='quarter'?t('Q{quarter}',{quarter:range.number})+' · '+t('Periods {first}–{last}',{first:range.firstPeriod,last:range.lastPeriod}):t('Period')+' '+range.number;
 const cells=(r:PeriodRow)=><>{[r.assignments,r.refunds,r.net,r.completed,r.nonCompletions,r.removed,r.closing].map((value,i)=><td className="period-number" key={i}>{i===2?<strong>{value}</strong>:value}</td>)}{data?.platformAdmin&&<td className="period-number">{money(r.valueCents||0)}</td>}</>;
 const storeRow=(r:PeriodRow)=>{
  const lastDate=r.lastAssignedAt?new Intl.DateTimeFormat(languageLocale(lang),{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(r.lastAssignedAt)):null;
  return <tr key={r.storeId}><td className="period-label">{country(r.country)}</td><td className="period-label">{r.storeCode||'—'}</td><th scope="row" className="period-label period-store">{r.storeName}{!r.active?' · '+t('Archived'):''}
   {r.assignments===0&&data?.period.state!=='future'&&(lastDate?<details className="period-inactivity"><summary title={t('Last assignment')+': '+lastDate}>{t('Last assignment: {days} days ago',{days:r.daysSinceAssignment!})}</summary><span>{t('Last assignment')}: {lastDate}</span><span>{t('As of')}: {date(data!.asOf)}</span></details>:<small className="period-inactivity">{t('No recorded assignments')}</small>)}
  </th>{cells(r)}</tr>;
 };
 return <div className="period-report">
 {error&&<p className="error" role="alert">{t(error)} <Button variant="outline" onClick={()=>setRefresh(v=>v+1)}>{t('Try again')}</Button></p>}
 {loading&&<p role="status">{t('Loading training records…')}</p>}
 {data&&view&&<>
 <div className="period-controls"><label>{t('Accounting year')}<NativeSelect value={data.period.yearLabel} onChange={e=>{const ranges=data.ranges.filter(p=>p.yearLabel===e.target.value);setPeriod((ranges.find(p=>p.kind===data.period.kind&&p.number===data.period.number)||ranges.find(p=>p.kind==='period'&&p.state==='complete')||ranges.find(p=>p.kind==='period'&&p.state==='current')||ranges[0]).id);}}>{[...new Set(data.periods.map(p=>p.yearLabel))].map(y=><option key={y}>{y}</option>)}</NativeSelect></label>
 <label>{t('Reporting range')}<NativeSelect value={data.period.id} onChange={e=>setPeriod(e.target.value)}>{(['period','quarter','fytd'] as const).map(kind=>{const ranges=data.ranges.filter(p=>p.yearLabel===data.period.yearLabel&&p.kind===kind).sort((a,b)=>a.number-b.number);return ranges.length?<optgroup key={kind} label={t(kind==='period'?'Periods':kind==='quarter'?'Quarters':'Financial Year to Date')}>{ranges.map(p=><option key={p.id} value={p.id}>{rangeLabel(p)} · {date(p.startsOn)} – {date(p.endsOn)}</option>)}</optgroup>:null;})}</NativeSelect></label></div>
 <p className="report-note">{rangeLabel(data.period)} · {t('As of')} {date(data.asOf)} · {t('Accounting timezone')}: {'Europe/London'}</p>
 <div className="metrics period-metrics">{[['Assignments',view.totals.assignments],['Refunds',view.totals.refunds],['Net chargeable',view.totals.net],['Stores',view.totals.stores]].map(([label,value])=><div className="metric" key={label}><span>{t(String(label))}</span><strong>{value}</strong></div>)}</div>
 <div className="paper period-table"><div className="period-table-head"><h2>{t('By store')}</h2><Input type="search" aria-label={t('Search stores')} placeholder={t('Search stores')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <div className="period-store-controls"><label className="period-zero-filter"><input type="checkbox" checked={zeroOnly} onChange={e=>setZeroOnly(e.target.checked)}/>{t('No assignments in selected range')}</label><label className="period-sort">{t('Sort stores')}<NativeSelect value={sort} onChange={e=>setSort(e.target.value as Report['sort'])}><option value="store">{t('Country and store')}</option><option value="assignments">{t('Assignments: high to low')}</option><option value="inactive">{t('Longest inactive first')}</option></NativeSelect></label></div>
 <p className="report-note" role="status">{t('Showing {count} of {total} stores.',{count:view.rows.length,total:data.rows.length})}</p>
 <div className="table-scroll" tabIndex={0} role="region" aria-label={t('Period report')}><table className="period-data-table"><colgroup><col style={{width:'10%'}}/><col style={{width:'7%'}}/><col style={{width:'22%'}}/>{Array.from({length:data.platformAdmin?8:7},(_,i)=><col key={i} style={{width:`${61/(data.platformAdmin?8:7)}%`}}/>)}</colgroup><thead><tr>{['Country','Store code','Store','Assignments','Refunds','Net chargeable','Completions','Non completions','Removed','Closing credits',...(data.platformAdmin?['Value EUR']:[])].map((label,i)=><th scope="col" className={i<3?'period-label':'period-number'} key={label}><span lang={lang}>{lang==='en'?(englishHeadings[label]||t(label)):t(label)}</span></th>)}</tr></thead><tbody>
 {sort!=='store'?view.rows.map(storeRow):view.countries.map(group=><Fragment key={group.country}>{view.rows.filter(r=>r.country===group.country).map(storeRow)}<tr className="period-subtotal"><th className="period-label" scope="row" colSpan={3}>{country(group.country)} · {t('Country total')}</th>{cells(group)}</tr></Fragment>)}
 {!view.rows.length&&<tr><td colSpan={data.platformAdmin?11:10} className="period-empty">{t('No stores match these filters.')}</td></tr>}
 </tbody><tfoot><tr><th className="period-label" colSpan={3} scope="row">{t(search.trim()||zeroOnly?'Filtered total':'Overall total')}</th>{cells(view.totals)}</tr></tfoot></table></div>
 <p className="report-note">{t('Refunds use the removal date. Completions relate to assignments in the selected range.')}</p>
 <p className="report-note">{t('Inactivity is measured as of the report date using recorded assignment history.')}</p>
 </div><div className="report-export"><Button variant="outline" disabled={exporting} onClick={()=>void download()}>{t(exporting?'Preparing export…':'Export Excel')}</Button></div>
 {platformAdmin&&<CreditSettings filter={filter} onChange={()=>setRefresh(v=>v+1)}/>}
 </>}
 </div>;
}
