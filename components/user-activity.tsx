'use client';
import {useEffect,useState} from 'react';
import {Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useLanguage} from '@/components/language-provider';
import type {ReportFilter} from '@/lib/profile';
import type {Language} from '@/lib/i18n';
import {formatDate} from '@/lib/ui-copy';
import {formatLearningTime,statusLabels,type TrainingActivity} from '@/lib/training-report-types';

type Props={filter:ReportFilter;category:string;courseId:string;search:string;onSearch:(value:string)=>void;lang:Language};
export default function UserActivity({filter,category,courseId,search,onSearch,lang}:Props){
  const {t}=useLanguage();
  const [page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<{query:string;data:TrainingActivity|null;error:string}|null>(null);
  const term=search.trim();
  const query=new URLSearchParams({...filter,view:'activity',category,course:courseId,search:term,page:String(page)}).toString();
  const current=result?.query===query?result:null;
  const loading=!!term&&!current;
  useEffect(()=>{
    if(!term){setResult(null);return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      fetch('/api/reporting?'+query,{cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load reporting.');return data;}).then(data=>{if(!controller.signal.aborted)setResult({query,data,error:''});}).catch(error=>{if(!controller.signal.aborted)setResult({query,data:null,error:error.message});});
    },300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[term,query,retry]);
  const data=current?.data,employees=new Map(data?.employees.map(p=>[p.id,p])),courses=new Map(data?.courses.map(c=>[c.id,c]));
  return <div className="paper people report-people user-activity">
    <div className="people-head"><div><h2>{t('User activity')}</h2><p>{t('Current status for each employee and course')}</p></div>
      <div className="search"><Search/><Input aria-label={t('Search by name, email or Workday ID')} placeholder={t('Name, email or Workday ID')} maxLength={200} value={search} onChange={e=>{setPage(1);onSearch(e.target.value);}}/></div>
    </div>
    {!term?<div className="empty">{t('Enter a name, email or Workday ID. Results appear 25 at a time.')}</div>:<div aria-busy={loading}>
      {loading&&<div className="empty" role="status">{t('Loading training records…')}</div>}
      {current?.error&&<div className="error" role="alert">{t(current.error)}<Button variant="outline" onClick={()=>{setResult(null);setRetry(v=>v+1);}}>{t('Try again')}</Button></div>}
      {data&&<><div className="table-scroll"><table><thead><tr><th>{t('Employee')}</th><th>{t('Course')}</th><th>{t('Status')}</th><th>{t('Completed')}</th><th>{t('Expires')}</th><th>{t('Recorded learning time')}<small>{t("HH:MM:SS")}</small></th></tr></thead><tbody>{data.records.map(r=>{
        const p=employees.get(r.learnerId)!,c=courses.get(r.courseId)!;
        return <tr key={JSON.stringify([r.learnerId,r.courseId])}><td><strong dir="auto">{p.name}</strong><small dir="ltr">{p.email}</small>{p.workdayId&&<small>{t('Workday ID')}: {p.workdayId}</small>}<small>{p.storeName}{p.archivedAt?' · '+t('Archived'):''}</small></td><td>{c.title}<small>{t(c.category)}</small></td><td><span className="training-status"><i className={'training-dot '+r.status} aria-hidden="true"/>{t(statusLabels[r.status])}</span></td><td>{formatDate(r.completedAt,lang)}</td><td>{r.expiresAt?formatDate(r.expiresAt,lang):'—'}</td><td dir="ltr">{formatLearningTime(r.learningSeconds)}</td></tr>;
      })}</tbody></table>{!data.records.length&&<div className="empty" role="status">{t('No training records match this view.')}</div>}</div>
      <div className="activity-pagination"><span role="status">{t('Page {page} · Up to 25 records',{page:data.page})}</span><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{t('Previous')}</Button><Button variant="outline" disabled={!data.hasMore} onClick={()=>setPage(v=>v+1)}>{t('Next')}</Button></div></>}
    </div>}
  </div>;
}

