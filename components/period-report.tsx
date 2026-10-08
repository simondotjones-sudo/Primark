'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import type {ReportFilter} from '@/lib/profile';
import type {PeriodReport as Report,PeriodRow} from '@/lib/period-report';
import CreditSettings from '@/components/credit-settings';
import './period-report.css';
export default function PeriodReporting({filter,platformAdmin}:{filter:ReportFilter;platformAdmin:boolean}){
 const {t,date,country}=useLanguage();
 const [data,setData]=useState<Report|null>(null),[period,setPeriod]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[refresh,setRefresh]=useState(0),[search,setSearch]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setError('');
  fetch('/api/reporting/periods?'+new URLSearchParams({...filter,...(period?{period}:{})}),{cache:'no-store',signal:controller.signal})
   .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(d=>{if(!controller.signal.aborted){setData(d);setLoading(false);}})
   .catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoading(false);}});
  return()=>controller.abort();
 },[filter.role,filter.country,filter.site,period,refresh]);
 async function download(){setExporting(true);setError('');try{
  const r=await fetch('/api/reporting/periods?'+new URLSearchParams({...filter,period:data!.period.id,export:'xlsx'}),{cache:'no-store'});
  if(!r.ok)throw new Error((await r.json()).error);const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=`primark-${data!.period.id}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setExporting(false);}}
 const money=(cents:number)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
 const cells=(r:PeriodRow)=><><td>{r.assignments}</td><td>{r.refunds}</td><td><strong>{r.net}</strong></td><td>{r.completed}</td><td>{r.nonCompletions}</td><td>{r.removed}</td><td>{r.closing}</td>{data?.platformAdmin&&<td>{money(r.valueCents||0)}</td>}</>;
 const shown=(r:PeriodRow)=>!search.trim()||(r.storeName+' '+(r.storeCode||'')+' '+r.country).toLowerCase().includes(search.trim().toLowerCase());
 return <div className="period-report">
 {error&&<p className="error" role="alert">{t(error)} <Button variant="outline" onClick={()=>setRefresh(v=>v+1)}>{t('Try again')}</Button></p>}
 {loading&&<p role="status">{t('Loading training records…')}</p>}
 {data&&<>
 <div className="period-controls"><label>{t('Accounting year')}<NativeSelect value={data.period.yearLabel} onChange={e=>{const periods=data.periods.filter(p=>p.yearLabel===e.target.value);setPeriod((periods.find(p=>p.state==='complete')||periods.find(p=>p.state==='current')||periods.at(-1))!.id);}}>{[...new Set(data.periods.map(p=>p.yearLabel))].map(y=><option key={y}>{y}</option>)}</NativeSelect></label>
 <label>{t('Period')}<NativeSelect value={data.period.id} onChange={e=>setPeriod(e.target.value)}>{data.periods.filter(p=>p.yearLabel===data.period.yearLabel).toReversed().map(p=><option key={p.id} value={p.id}>{t('Period')} {p.number} · {date(p.startsOn)} – {date(p.endsOn)}</option>)}</NativeSelect></label></div>
 <p className="report-note">{t(data.period.state==='current'?'Current period':'Period report')} · {t('Accounting timezone')}: {'Europe/London'}</p>
 <div className="metrics period-metrics">{[['Assignments',data.totals.assignments],['Refunds',data.totals.refunds],['Net chargeable',data.totals.net],['Stores',data.totals.stores]].map(([label,value])=><div className="metric" key={label}><span>{t(String(label))}</span><strong>{value}</strong></div>)}</div>
 <div className="paper period-table"><div className="period-table-head"><h2>{t('By store')}</h2><Input type="search" aria-label={t('Search stores')} placeholder={t('Search stores')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <div className="table-scroll" tabIndex={0} role="region" aria-label={t('Period report')}><table><thead><tr>{['Country','Store code','Store','Assignments','Refunds','Net chargeable','Completions','Non completions','Removed','Closing credits',...(data.platformAdmin?['Value EUR']:[])].map(label=><th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>
 {data.countries.map(group=>{const rows=data.rows.filter(r=>r.country===group.country&&shown(r));if(!rows.length)return null;return <PeriodGroup key={group.country} rows={rows} group={group} showTotal={!search.trim()} countryLabel={country(group.country)} cells={cells} t={t}/>;})}
 </tbody>{!search.trim()&&<tfoot><tr><th colSpan={3} scope="row">{t('Overall total')}</th>{cells(data.totals)}</tr></tfoot>}</table></div>
 <p className="report-note">{t('All stores are included. Refunds use the removal date. Completions use the assignment group at period end.')}</p>
 </div><div className="report-export"><Button variant="outline" disabled={exporting} onClick={()=>void download()}>{t(exporting?'Preparing export…':'Export Excel')}</Button></div>
 {platformAdmin&&<CreditSettings filter={filter} onChange={()=>setRefresh(v=>v+1)}/>}
 </>}
 </div>;
}
function PeriodGroup({rows,group,showTotal,countryLabel,cells,t}:{rows:PeriodRow[];group:PeriodRow;showTotal:boolean;countryLabel:string;cells:(r:PeriodRow)=>React.ReactNode;t:(text:string)=>string}){
 return <>{rows.map(r=><tr key={r.storeId}><td>{countryLabel}</td><td>{r.storeCode||'—'}</td><th scope="row">{r.storeName}{!r.active?' · '+t('Archived'):''}</th>{cells(r)}</tr>)}{showTotal&&<tr className="period-subtotal"><th scope="row" colSpan={3}>{countryLabel} · {t('Country total')}</th>{cells(group)}</tr>}</>;
}
