'use client';
import CourseRenewalNotice from '@/components/course-renewal-notice';
import type {CourseRenewal} from '@/lib/course-renewals';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import SafetyPassport from '@/components/safety-passport';
import type {SafetyPassportRecord} from '@/lib/safety-passport';
import {useLanguage} from '@/components/language-provider';
import { certificateStatus, type Certificate } from '@/lib/certificates';
import '@/app/certificates/certificates.css';
import './assigned-courses.css';
import {Check} from 'lucide-react';
import { useEffect, useState } from 'react';
import CourseMetadata from '@/components/course-metadata';
import CourseProgress from '@/components/course-progress';
import type { CoursePanelDetails } from '@/lib/course-panel-details';
import CourseCover from '@/components/course-cover';
import type { CourseCoverKey } from '@/lib/course-covers';
type AssignedCourse = CoursePanelDetails & {
  id: string; title: string; description: string; coverKey: CourseCoverKey;
  status: 'Not started' | 'In progress' | 'Completed';
  progressPercent: number | null;
  renewal?:CourseRenewal;
  passport?: SafetyPassportRecord | null;
  certificate:{token:string;expiresAt:string|null;completedAt:string}|null;
  scos: {id: string; title: string; status: string; score: string | null}[];
};

export type CourseView = 'induction' | 'all' | 'todo' | 'completed' | 'certs';

export default function AssignedCourses({view = 'all', hasLegacyCourse = false}: {view?: CourseView; hasLegacyCourse?: boolean}) {
  const {t,date}=useLanguage();

  const [courses, setCourses] = useState<AssignedCourse[] | null>(null);
  const [selected,setSelected]=useState<AssignedCourse|null>(null),[busy,setBusy]=useState(false),[renewalError,setRenewalError]=useState(''),[notice,setNotice]=useState('');
  const [error, setError] = useState('');
  const [inductionPending, setInductionPending] = useState(false);
  const [certificates, setCertificates] = useState<Certificate[] | null>(null);
  const [certificateError, setCertificateError] = useState('');
  async function loadCourses(){
    const r=await fetch('/api/courses',{cache:'no-store'}),d=await r.json();
    if(!r.ok)throw new Error(d.error);
    setCourses(d.courses);setInductionPending(!!d.inductionPending);setError('');
  }
  useEffect(()=>{void loadCourses().catch(e=>setError(e.message));},[]);
  async function renew(){
    if(!selected?.certificate)return;
    setBusy(true);setRenewalError('');
    try{
      const r=await fetch('/api/courses/renew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseId:selected.id,certificateToken:selected.certificate.token})}),d=await r.json();
      if(!r.ok)throw new Error(d.error);
      setSelected(null);setCertificates(null);setCertificateError('');setNotice('Course renewed. Your previous completion has been saved.');
      await loadCourses().catch(e=>setError(e.message));
    }catch(e){setRenewalError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  useEffect(() => {
    if (view !== 'certs' || certificates !== null || certificateError) return;
    let active = true;
    fetch('/api/certificates', {cache: 'no-store'}).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (active) setCertificates(data.certificates);
    }).catch(e => {if (active) setCertificateError(e.message);});
    return () => {active = false;};
  }, [view, certificates, certificateError]);
  const visibleCourses = courses?.filter(c => {
    if (view === 'induction') return c.category.trim().toLowerCase() === 'induction';
    if (view === 'completed') return c.status === 'Completed';
    if (view === 'todo') return c.status !== 'Completed' || c.renewal?.canRenew || (c.renewal?.refresher && c.renewal.refresher.status !== 'completed');
    return view === 'all';
  }) ?? [];
  const showInductionPending = inductionPending && (view === 'all' || view === 'induction' || view === 'todo');
  return <section className="assigned-courses">
    {notice&&<p role="status">{t(notice)}</p>}
    <Dialog open={!!selected} onOpenChange={open=>{if(!open&&!busy)setSelected(null);}}><DialogContent><DialogHeader><DialogTitle>{t('Restart course')}</DialogTitle><DialogDescription>{selected?.title}</DialogDescription></DialogHeader>
      <p>{t('A new assignment will use one credit. Previous training evidence is retained.')}</p>
      <p>{t('Your progress will reset. Your previous completion date and certificate will remain in your training history.')}</p>
      {renewalError&&<p role="alert" className="error">{t(renewalError)}</p>}
      <div className="editor-actions"><Button variant="outline" disabled={busy} onClick={()=>setSelected(null)}>{t('Cancel')}</Button><Button disabled={busy} onClick={()=>void renew()}>{t(busy?'Saving…':'Restart course')}</Button></div>
    </DialogContent></Dialog>
    {view === 'certs' ? (
      certificateError ? <p role="alert">{t(certificateError)}</p> :
      certificates === null ? <p>{t('Loading your certificates…')}</p> :
      certificates.length ? <div className="certificate-list">{certificates.map(record => {
        const status = certificateStatus(record.expires_at);
        return <a key={record.token} href={'/certificates/'+record.token+'/'} className="certificate-card">
          <span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{t(status)}</span>
          <h2 dir="auto">{record.course_title}</h2>
          {record.archived_at&&<p>{t('Previous completion')}</p>}
          <p>{t('Completed {date}', {date:date(record.completed_at)})}<br/>{record.expires_at ? t('Expires {date}', {date:date(record.expires_at)}) : t('No expiry')}</p>
          <strong>{t('View certificate')} →</strong>
        </a>;
      })}</div> : <div className="certificates-empty">{t('Your certificates will appear here when you complete a course.')}</div>
    ) : <>
    {showInductionPending && <p>{t("Your induction is being prepared. It will appear here when it is available.")}</p>}
    {error ? <p role="alert">{t(error)}</p> : courses === null ? <p>{t("Loading your courses…")}</p> : visibleCourses.length ?
      <div className="course-catalog-grid">{visibleCourses.map(c => {
        const card = <article className="paper assigned-course" key={c.id}>
          <a href={`/learn/${c.id}/`} aria-label={t("Open {title}",{title:c.title})} className="assigned-course-cover"><CourseCover coverKey={c.coverKey}
            sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1340px) calc(50vw - 37px), 634px" /></a>
          <div className="assigned-course-details">
          <h3><a href={`/learn/${c.id}/`}>{c.title}</a></h3>
          <CourseMetadata details={c}/>
          {c.description && <p>{c.description}</p>}
          <CourseProgress status={c.status} percent={c.progressPercent} title={c.title}/>
          {c.certificate&&<><span className={'certificate-status is-'+certificateStatus(c.certificate.expiresAt).toLowerCase().replaceAll(' ','-')}>{t(certificateStatus(c.certificate.expiresAt))}</span><p className="course-expiry">{c.certificate.expiresAt?t('Expires {date}',{date:date(c.certificate.expiresAt)}):t('No expiry')}</p></>}
          <CourseRenewalNotice certificate={c.certificate} renewal={c.renewal} onRenew={()=>{setRenewalError('');setSelected(c);}}/>
          <div className="assigned-course-actions"><a href={`/learn/${c.id}/`}>{t(c.status === 'Completed' ? 'Review course' : c.status === 'In progress' ? 'Continue course' : 'Start course')}</a>{c.certificate&&<a href={'/certificates/'+c.certificate.token+'/'}>{t("View certificate")}</a>}</div>
          </div>
        </article>;
        return c.status==='Completed'&&c.category.trim().toLowerCase()==='induction'&&c.passport
          ? <div className="induction-course-pair" key={c.id}>{card}<SafetyPassport record={c.passport}/></div>
          : card;
      })}</div> : !showInductionPending && !hasLegacyCourse && (view === 'todo' ?
        <div className="certificates-empty courses-clear" role="status">
          <span className="courses-clear-tick" aria-hidden="true"><Check size={32} strokeWidth={2}/></span>
          <h2>{t("You're all set!")}</h2>
          <p>{t('Congratulations — you have no courses to do right now.')}</p>
        </div>
        : view === 'completed' ? <div className="certificates-empty">{t("You haven't completed any courses yet.")}</div> : <p>{t(view === 'induction' ? "No induction courses have been assigned to you yet." : "No additional courses have been assigned to you yet.")}</p>)}
    </>}
  </section>;
}
