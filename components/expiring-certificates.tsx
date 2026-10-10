'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {useLanguage} from '@/components/language-provider';
import type {ReportFilter} from '@/lib/profile';
import type {Language} from '@/lib/i18n';
import type {ExpiringCertificates} from '@/lib/training-report-types';
import {countryName,formatDate} from '@/lib/ui-copy';

type Props={filter:ReportFilter;category:string;courseId:string;lang:Language};
export default function ExpiringCertificatesCard({count,...props}:Props&{count:number}){
  const {t}=useLanguage();
  const [open,setOpen]=useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="metric metric-expiring"><span>{t('Expiring soon')}</span><strong>{count}</strong><small>{t('People · Next 30 days')}<span className="metric-link">{t('View list')}<ArrowUpRight size={14}/></span></small></button></DialogTrigger>
    <DialogContent className="expiry-dialog"><DialogHeader><DialogTitle>{t('Certificates expiring soon')}</DialogTitle><DialogDescription>{t('People with certificates expiring in the next 30 days.')}</DialogDescription></DialogHeader>
      {open&&<ExpiringPeople key={JSON.stringify([props.filter,props.category,props.courseId])} {...props}/>}
    </DialogContent>
  </Dialog>;
}

function ExpiringPeople({filter,category,courseId,lang}:Props){
  const {t}=useLanguage();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<{query:string;data:ExpiringCertificates|null;error:string}|null>(null);
  const query=new URLSearchParams({...filter,view:'expiring',category,course:courseId,search:search.trim(),page:String(page)}).toString();
  const current=result?.query===query?result:null;
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      fetch('/api/reporting?'+query,{cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load reporting.');return data;}).then(data=>{if(!controller.signal.aborted)setResult({query,data,error:''});}).catch(error=>{if(!controller.signal.aborted)setResult({query,data:null,error:error.message});});
    },search.trim()?300:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,retry,search]);
  const data=current?.data,courses=new Map(data?.courses.map(c=>[c.id,c]));
  return <>
    <div className="search expiry-search"><Search size={18}/><Input autoFocus aria-label={t('Search by name, email or Workday ID')} placeholder={t('Name, email or Workday ID')} maxLength={200} value={search} onChange={e=>{setPage(1);setSearch(e.target.value);}}/></div>
    <div className="expiry-results" aria-busy={!current}>
      {!current&&<div className="empty" role="status">{t('Loading training records…')}</div>}
      {current?.error&&<div className="error" role="alert">{t(current.error)}<Button variant="outline" onClick={()=>{setResult(null);setRetry(v=>v+1);}}>{t('Try again')}</Button></div>}
      {data&&<><p className="expiry-count" role="status">{t('{count} people',{count:data.totalPeople})}</p>
        {!data.employees.length?<div className="empty" role="status">{t('No certificates expire in the next 30 days in this view.')}</div>:<div className="expiry-people">{data.employees.map(p=><article className="expiry-person" key={p.id}>
          <div className="expiry-person-heading"><div><h3 dir="auto">{p.name}</h3><p dir="ltr">{p.email}</p>{p.workdayId&&<p>{t('Workday ID')}: {p.workdayId}</p>}</div><p>{p.storeName}<span>{countryName(p.country,lang)}</span></p></div>
          <ul>{data.records.filter(r=>r.learnerId===p.id).map(r=><li key={r.courseId}><strong>{courses.get(r.courseId)?.title}</strong><span>{t('Expires')}: {formatDate(r.expiresAt,lang)}<small>{t('Expires in {days} days',{days:Math.max(1,Math.ceil((Date.parse(r.expiresAt!)-Date.parse(data.generatedAt))/86400000))})}</small></span></li>)}</ul>
        </article>)}</div>}
        <div className="activity-pagination"><span>{t('Page {page}',{page:data.page})}</span><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{t('Previous')}</Button><Button variant="outline" disabled={!data.hasMore} onClick={()=>setPage(v=>v+1)}>{t('Next')}</Button></div>
      </>}
    </div>
  </>;
}
