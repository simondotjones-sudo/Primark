'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, Globe2, Search, Store, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { profileScope, type ReportFilter } from '@/lib/profile';
import type { ReportingAccess } from '@/lib/reporting-types';
import { ORIGINAL_INDUCTION, statusLabels, type ReportEmployee, type ReportCourse, type TrainingRecord, type TrainingReport } from '@/lib/training-report-types';
import { countryName, formatDate, tr } from '@/lib/ui-copy';
import { languageLocale, type Language } from '@/lib/i18n';
import { courseLanguages } from '@/lib/course-catalogue';
import './training-report.css';

type Props={access:ReportingAccess;platformAdmin:boolean;filter:ReportFilter;onFilterChange:(filter:ReportFilter)=>void;lang:Language};
type Cell={person:ReportEmployee;course:ReportCourse;record?:TrainingRecord};
const key=(learnerId:string,courseId:string)=>JSON.stringify([learnerId,courseId]);
function csvCell(value:unknown){let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function saveCsv(name:string,rows:unknown[][]){const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export default function TrainingReporting({access,platformAdmin,filter,onFilterChange,lang}:Props){
  const t=(s:string)=>tr(lang,s);
  const scope=profileScope(access,filter);
  const [data,setData]=useState<TrainingReport|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [category,setCategory]=useState('all');
  const [courseId,setCourseId]=useState('all');
  const [view,setView]=useState<'overview'|'matrix'>('overview');
  const [search,setSearch]=useState('');
  const [year,setYear]=useState(String(new Date().getUTCFullYear()));
  const [month,setMonth]=useState('all');
  const [cell,setCell]=useState<Cell|null>(null);
  const [csv,setCsv]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const isMatrix=view==='matrix'&&filter.role==='site';
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setCell(null);
    fetch('/api/reporting?'+new URLSearchParams(filter),{cache:'no-store',signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Could not load reporting.');return result;}).then(result=>{if(!controller.signal.aborted){setData(result);setLoading(false);}}).catch(e=>{if(e.name!=='AbortError'){setData(null);setError(e.message);setLoading(false);}});
    return()=>controller.abort();
  },[filter.role,filter.country,filter.site,access.scope,access.country,access.siteId,refresh]);
  useEffect(()=>{if(filter.role!=='site')setView('overview');},[filter.role]);
  const categories=useMemo(()=>[...new Set(data?.courses.map(c=>c.category)||[])].sort(),[data]);
  const activeCategory=categories.includes(category)?category:'all';
  const options=useMemo(()=>data?.courses.filter(c=>activeCategory==='all'||c.category===activeCategory)||[],[data,activeCategory]);
  const activeCourse=options.some(c=>c.id===courseId)?courseId:'all';
  const courses=useMemo(()=>options.filter(c=>activeCourse==='all'||c.id===activeCourse),[options,activeCourse]);
  const courseMap=useMemo(()=>new Map(courses.map(c=>[c.id,c])),[courses]);
  const employees=data?.employees||[];
  const employeeMap=useMemo(()=>new Map(data?.employees.map(p=>[p.id,p])||[]),[data]);
  const records=useMemo(()=>data?.records.filter(r=>courseMap.has(r.courseId))||[],[data,courseMap]);
  const recordMap=useMemo(()=>new Map(records.map(r=>[key(r.learnerId,r.courseId),r])),[records]);
  const matchesSearch=(p:ReportEmployee)=>`${p.name} ${p.email} ${p.storeName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const people=employees.filter(matchesSearch);
  const visibleRecords=records.filter(r=>{const person=employeeMap.get(r.learnerId);return person&&matchesSearch(person);});
  const inPeriod=(date:string|null)=>!!date&&(year==='all'||(date.slice(0,4)===year&&(month==='all'||Number(date.slice(5,7))===Number(month))));
  const years=[...new Set([new Date().getUTCFullYear(),...records.filter(r=>r.completedAt).map(r=>Number(r.completedAt!.slice(0,4)))])].sort((a,b)=>b-a);
  const completed=records.filter(r=>inPeriod(r.completedAt)).length;
  const locale=languageLocale(lang);
  const today=new Date();
  const trend=Array.from({length:12},(_,i)=>{
    const d=year==='all'?new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-11+i,1)):new Date(Date.UTC(Number(year),i,1));
    const monthKey=d.toISOString().slice(0,7);
    return {label:new Intl.DateTimeFormat(locale,{month:'short',...(year==='all'?{year:'2-digit'}:{})}).format(d),completed:records.filter(r=>r.completedAt?.slice(0,7)===monthKey).length};
  });
  const groups=useMemo(()=>{
    const map=new Map<string,{id:string;label:string;total:number;completed:number;expired:number}>();
    for(const record of records){const person=employeeMap.get(record.learnerId)!;const id=filter.role==='global'?person.country:person.storeId;const group=map.get(id)||{id,label:filter.role==='global'?countryName(person.country,lang):person.storeName,total:0,completed:0,expired:0};group.total++;if(record.status==='completed')group.completed++;if(record.status==='expired')group.expired++;map.set(id,group);}
    return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label));
  },[records,employeeMap,filter.role,lang]);
  function changeScope(next:Partial<ReportFilter>){onFilterChange(profileScope(access,{...filter,...next}).filter);setSearch('');}
  function exportReport(){
    if(isMatrix){saveCsv('primark-site-matrix.csv',[
      ['Employee','Email',...courses.map(c=>c.title)],
      ...people.map(p=>[p.name,p.email,...courses.map(c=>{const r=recordMap.get(key(p.id,c.id));return r?statusLabels[r.status]:'Not assigned';})]),
    ]);return;}
    saveCsv('primark-training-report.csv',[
      ['Employee','Email','Country','Store','Course','Category','Status','Completed','Expires','Score','Completion in selected period'],
      ...visibleRecords.map(r=>{const p=employeeMap.get(r.learnerId)!;const c=courseMap.get(r.courseId)!;return [p.name,p.email,p.country,p.storeName,c.title,c.category,statusLabels[r.status],r.completedAt,r.expiresAt,r.score,inPeriod(r.completedAt)?'Yes':'No'];}),
    ]);
  }
  async function originalAction(action:string,body:Record<string,unknown>={}){
    setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/prototype',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body})});const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage(action==='import'?`${result.imported} historical rows imported.`:'Sample learners loaded.');setRefresh(v=>v+1);}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  const statusText=(r?:TrainingRecord)=>r?t(statusLabels[r.status]):t('Not assigned');
  return <section className="report training-report">
    <div className="report-header"><div><span className="eyebrow">PRIMARK · {t('LEARNING OVERVIEW')}</span><h1>{t('Training progress')}</h1><p>{t('A clear view of learning, across every course.')}</p></div><Button variant="outline" disabled={loading||!data} onClick={exportReport}><Download/>{t('Export CSV')}</Button></div>
    <div className="scope report-scope">
      <span><Globe2/>{t('Reporting view')}</span>
      <div className="report-location">
        <label><span className="sr-only">{t('Country')}</span><NativeSelect aria-label={t('Reporting country')} value={filter.role==='global'?'all':filter.country} disabled={filter.role==='global'||scope.countries.length<2} onChange={e=>changeScope({country:e.target.value})}>{filter.role==='global'?<option value="all">{t('All countries')}</option>:scope.countries.map(c=><option key={c} value={c}>{countryName(c,lang)}</option>)}</NativeSelect></label>
        <label className="store-picker"><span className="sr-only">{t('Store')}</span><NativeSelect aria-label={t('Reporting store')} value={filter.role==='site'?filter.site:'all'} disabled={filter.role!=='site'||scope.sites.length<2} onChange={e=>changeScope({site:e.target.value})}>{filter.role!=='site'?<option value="all">{t('All stores')}</option>:scope.sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>
      </div>
      <div className="scope-buttons" role="group" aria-label={t('Reporting view')}>{scope.roles.map(role=><button key={role} aria-pressed={filter.role===role} className={filter.role===role?'selected':''} onClick={()=>changeScope({role})}>{t(role==='global'?'Global':role==='country'?'Country':'Store')}</button>)}</div>
    </div>
    <div className="report-filters"><label>{t('Category')}<NativeSelect aria-label={t('Course category')} disabled={loading} value={activeCategory} onChange={e=>{setCategory(e.target.value);setCourseId('all');setCell(null);}}><option value="all">{t('All categories')}</option>{categories.map(c=><option key={c} value={c}>{t(c)}</option>)}</NativeSelect></label><label className="course-filter">{t('Course')}<NativeSelect aria-label={t('Reporting course')} disabled={loading} value={activeCourse} onChange={e=>{setCourseId(e.target.value);setCell(null);}}><option value="all">{t('All courses')}</option>{options.map(c=><option key={c.id} value={c.id}>{c.title}{c.paused?' · Paused':''}</option>)}</NativeSelect></label>{(activeCategory!=='all'||activeCourse!=='all')&&<button className="report-reset" onClick={()=>{setCategory('all');setCourseId('all');}}><X size={14}/>{t('Clear')}</button>}<div className="report-view-tabs" role="group" aria-label={t('Report format')}><button aria-pressed={!isMatrix} className={!isMatrix?'selected':''} onClick={()=>setView('overview')}>{t('Overview')}</button>{filter.role==='site'&&<button aria-pressed={isMatrix} className={isMatrix?'selected':''} onClick={()=>setView('matrix')}>{t('Site matrix')}</button>}</div></div>
    {error&&<div className="error" role="alert">{error}<Button variant="outline" onClick={()=>setRefresh(v=>v+1)}>{t('Try again')}</Button></div>}
    <div className="report-results" aria-busy={loading}>
    {loading&&<div className={data?'report-refreshing':'paper report-loading'} role="status">{t('Loading training records…')}</div>}
    {data&&<div className="report-results-content" aria-hidden={loading} inert={loading}>
    {isMatrix?<div className="paper matrix-card">
      <div className="people-head"><div><h2>{t('Site matrix')}</h2><p>{scope.sites.find(s=>s.id===filter.site)?.name} · {people.length} {t('employees')} · {courses.length} {t('courses')}</p></div><EmployeeSearch value={search} onChange={setSearch} label={t('Search employees')}/></div>
      <div className="matrix-legend">{Object.entries(statusLabels).map(([status,label])=><span key={status}><i aria-hidden="true" className={'training-dot '+status}/>{t(label)}</span>)}<span><i className="unassigned-mark" aria-hidden="true">—</i>{t('Not assigned')}</span></div>
      <div className="matrix-scroll" tabIndex={0} role="region" aria-label={t('Employee training matrix')}>
        {people.length&&courses.length?<table className="training-matrix"><caption className="sr-only">{t('Current training status. Select a dot to see completion and expiry dates.')}</caption><thead><tr><th scope="col" className="employee-column">{t('Employee')}</th>{courses.map(c=><th scope="col" key={c.id}><span title={c.title}>{c.title}</span><small>{t(c.category)}{c.paused?' · Paused':''}</small></th>)}</tr></thead><tbody>{people.map(p=><tr key={p.id}><th scope="row" className="employee-column"><strong dir="auto">{p.name}</strong><small dir="ltr">{p.email}</small></th>{courses.map(c=>{const r=recordMap.get(key(p.id,c.id));return <td key={c.id}><button className="matrix-cell" onClick={()=>setCell({person:p,course:c,record:r})} aria-label={`${p.name}, ${c.title}: ${statusText(r)}`} title={statusText(r)}>{r?<i className={'training-dot '+r.status} aria-hidden="true"/>:<span className="unassigned-mark" aria-hidden="true">—</span>}</button></td>;})}</tr>)}</tbody></table>:<div className="empty">{!courses.length?t('No courses match this view.'):t('No employees match this view.')}</div>}
      </div><p className="matrix-hint">{t('Current status · Select a dot for details')}{courses.length>5?' · '+t('Scroll across for more courses'):''}</p>
    </div>:<>
      <div className="completion-period"><span>{t('Completion period')}</span><label><span className="sr-only">{t('Year')}</span><NativeSelect aria-label={t('Completion year')} value={year} onChange={e=>{setYear(e.target.value);setMonth('all');}}><option value="all">{t('All time')}</option>{[...new Set([...years,Number(year)])].filter(Number.isFinite).sort((a,b)=>b-a).map(y=><option key={y} value={y}>{y}</option>)}</NativeSelect></label><label><span className="sr-only">{t('Month')}</span><NativeSelect aria-label={t('Completion month')} value={month} disabled={year==='all'} onChange={e=>setMonth(e.target.value)}><option value="all">{t('All months')}</option>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Intl.DateTimeFormat(locale,{month:'long'}).format(new Date(Date.UTC(2026,i,1)))}</option>)}</NativeSelect></label></div>
      <div className="metrics"><ReportMetric label={t('Employees')} value={new Set(records.map(r=>r.learnerId)).size} detail={`${records.length} ${t('course records')}`}/><ReportMetric label={t('In progress')} value={records.filter(r=>r.status==='in-progress').length} detail={t('Courses underway now')}/><ReportMetric label={t('Completed')} value={completed} detail={t('Completions in selected period')} blue/><ReportMetric label={t('Expired')} value={records.filter(r=>r.status==='expired').length} detail={t('Require renewal now')}/></div>
      <div className="paper trend-card"><div className="card-head"><div><h2>{t('Course completions')}</h2><p>{year==='all'?t('Last 12 months'):year} · {t('Monthly trend')}</p></div><span className="trend-key"><i className="completed-key"/>{t('Completed')}</span></div><div className="trend-chart" role="img" aria-label={trend.map(v=>`${v.label}: ${v.completed}`).join(', ')} dir="ltr"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{top:14,right:15,bottom:0,left:-18}}><CartesianGrid stroke="#e9eff3" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill:'#748a97',fontSize:12}}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{fill:'#748a97',fontSize:12}}/><Tooltip contentStyle={{borderRadius:12,border:'1px solid #dce8ef'}}/><Line type="monotone" dataKey="completed" name={t('Completed')} stroke="#008bc9" strokeWidth={3} dot={{r:3}} isAnimationActive={false}/></LineChart></ResponsiveContainer></div></div>
      {filter.role!=='site'&&<div className="paper report-breakdown"><div className="card-head"><div><h2>{t(filter.role==='global'?'By country':'By store')}</h2><p>{t('Current course status')}</p></div><Store/></div><div className="table-scroll"><table><thead><tr><th>{t(filter.role==='global'?'Country':'Store')}</th><th>{t('Course records')}</th><th>{t('Completed')}</th><th>{t('Expired')}</th></tr></thead><tbody>{groups.map(g=><tr key={g.id}><td><button className="report-drill" onClick={()=>filter.role==='global'?changeScope({role:'country',country:g.id}):changeScope({role:'site',site:g.id})}>{g.label}</button></td><td>{g.total}</td><td><b className="count-pill">{g.completed}</b></td><td>{g.expired||'—'}</td></tr>)}</tbody></table>{!groups.length&&<div className="empty">{t('No training records in this view yet.')}</div>}</div></div>}
      <div className="paper people report-people"><div className="people-head"><div><h2>{t('Course activity')}</h2><p>{t('Current status for each employee and course')}</p></div><EmployeeSearch value={search} onChange={setSearch} label={t('Search employees')}/></div><div className="table-scroll"><table><thead><tr><th>{t('Employee')}</th><th>{t('Course')}</th><th>{t('Status')}</th><th>{t('Completed')}</th><th>{t('Expires')}</th></tr></thead><tbody>{visibleRecords.map(r=>{const p=employeeMap.get(r.learnerId)!;const c=courseMap.get(r.courseId)!;return <tr key={key(r.learnerId,r.courseId)}><td><strong dir="auto">{p.name}</strong><small>{p.storeName}</small></td><td>{c.title}<small>{t(c.category)}</small></td><td><span className="training-status"><i className={'training-dot '+r.status} aria-hidden="true"/>{statusText(r)}</span></td><td>{formatDate(r.completedAt,lang)}</td><td>{r.expiresAt?formatDate(r.expiresAt,lang):'—'}</td></tr>;})}</tbody></table>{!visibleRecords.length&&<div className="empty">{t('No training records match this view.')}</div>}</div></div>
      <p className="report-note">{t('Dates filter the Completed total. The trend shows the selected year; employee counts and statuses show the current position.')}</p>
      {data.legacy.length>0&&(activeCategory==='all'||activeCategory==='Induction')&&(activeCourse==='all'||activeCourse===ORIGINAL_INDUCTION)&&<details className="paper legacy-report"><summary>{t('Previous LMS')} · {data.legacy.filter(l=>year==='all'||inPeriod(l.completedAt)).length} {t('historical completions')}</summary><p>{t('Historical induction imports are kept separate from current course completion.')}</p><Button variant="outline" onClick={()=>saveCsv('primark-previous-lms.csv',[['Email','Store','Completed'],...data.legacy.filter(l=>year==='all'||inPeriod(l.completedAt)).map(l=>[l.email,l.storeName,l.completedAt])])}><Download/>{t('Export CSV')}</Button></details>}
    </>}
    </div>}
    </div>
    {platformAdmin&&!isMatrix&&<details className="paper import original-tools"><summary>{t('Original induction tools')}</summary><Button variant="outline" disabled={busy} onClick={()=>originalAction('seed')}>{t('Load sample learners')}</Button><p>{t('Import previous LMS completions')} · <code>email,completed,completed_at,site_id</code></p><textarea aria-label={t('Previous LMS CSV')} value={csv} onChange={e=>setCsv(e.target.value)} placeholder="email,completed,completed_at,site_id"/><div><label className="file-label">{t('Choose CSV file')}<input type="file" accept=".csv,text/csv" onChange={async e=>{const f=e.target.files?.[0];if(f)setCsv(await f.text());}}/></label><Button disabled={!csv||busy} onClick={()=>{try{void originalAction('import',{records:parseCsv(csv)});}catch(e){setError(e instanceof Error?e.message:'Check the CSV.');}}}>{t('Import CSV')}</Button><span role="status">{message}</span></div></details>}
    <Dialog open={!!cell} onOpenChange={open=>{if(!open)setCell(null);}}><DialogContent className="training-detail"><DialogHeader><DialogTitle>{cell?.person.name}</DialogTitle><DialogDescription>{cell?.course.title}</DialogDescription></DialogHeader>{cell&&<><div className="training-status detail-status">{cell.record?<i aria-hidden="true" className={'training-dot '+cell.record.status}/>:<span aria-hidden="true">—</span>}{statusText(cell.record)}</div><dl><div><dt>{t('Completed')}</dt><dd>{formatDate(cell.record?.completedAt||null,lang)}</dd></div><div><dt>{t('Expires')}</dt><dd>{cell.record?.expiresAt?formatDate(cell.record.expiresAt,lang):cell.record?.completedAt&&!cell.course.validityMonths?t('No expiry'):'—'}</dd></div>{cell.record?.score&&<div><dt>{t('Score')}</dt><dd>{cell.record.score}</dd></div>}<div><dt>{t('Language')}</dt><dd>{courseLanguages[cell.course.language]||cell.course.language}</dd></div></dl></>}</DialogContent></Dialog>
  </section>;
}
function ReportMetric({label,value,detail,blue=false}:{label:string;value:number;detail:string;blue?:boolean}){return <div className={'metric '+(blue?'metric-blue':'')}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;}
function EmployeeSearch({value,onChange,label}:{value:string;onChange:(value:string)=>void;label:string}){return <div className="search"><Search/><Input aria-label={label} placeholder={label} value={value} onChange={e=>onChange(e.target.value)}/></div>;}
function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[];let field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}row.push(field);if(row.some(v=>v.trim()))rows.push(row);if(!rows.length)throw new Error('The CSV is empty.');const headers=rows.shift()!.map(h=>h.trim().toLowerCase().replace(/^\uFEFF/,''));if(!headers.includes('email')||!headers.includes('completed'))throw new Error('CSV needs email and completed columns.');return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]?.trim()||''])));}
