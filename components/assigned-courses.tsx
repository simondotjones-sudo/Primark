'use client';
import {useLanguage} from '@/components/language-provider';
import { certificateStatus } from '@/lib/certificates';
import '@/app/certificates/certificates.css';
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
  certificate:{token:string;expiresAt:string|null;completedAt:string}|null;
  scos: {id: string; title: string; status: string; score: string | null}[];
};

export default function AssignedCourses() {
  const {t,date}=useLanguage();

  const [courses, setCourses] = useState<AssignedCourse[] | null>(null);
  const [error, setError] = useState('');
  const [inductionPending, setInductionPending] = useState(false);
  useEffect(() => {
    fetch('/api/courses', {cache: 'no-store'}).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCourses(d.courses);
      setInductionPending(!!d.inductionPending);
    }).catch(e => setError(e.message));
  }, []);
  return <section className="assigned-courses">
    <div className="section-title"><h2>{t("Assigned courses")}</h2><a href="/certificates/">{t("My certificates")}</a></div>
    {inductionPending && <p>{t("Your induction is being prepared. It will appear here when it is available.")}</p>}
    {error ? <p role="alert">{t(error)}</p> : courses === null ? <p>{t("Loading your courses…")}</p> : courses.length ?
      <div className="course-catalog-grid">{courses.map(c =>
        <article className="paper assigned-course" key={c.id}>
          <a href={`/learn/${c.id}/`} aria-label={t("Open {title}",{title:c.title})} className="assigned-course-cover"><CourseCover coverKey={c.coverKey}
            sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1340px) calc(50vw - 178px), 480px" /></a>
          <div className="assigned-course-details">
          <h3><a href={`/learn/${c.id}/`}>{c.title}</a></h3>
          <CourseMetadata details={c}/>
          {c.description && <p>{c.description}</p>}
          <CourseProgress status={c.status} percent={c.progressPercent} title={c.title}/>
          {c.certificate&&<><span className={'certificate-status is-'+certificateStatus(c.certificate.expiresAt).toLowerCase().replaceAll(' ','-')}>{t(certificateStatus(c.certificate.expiresAt))}</span><p className="course-expiry">{c.certificate.expiresAt?t('Expires {date}',{date:date(c.certificate.expiresAt)}):t('No expiry')}</p></>}
          <div className="assigned-course-actions"><a href={`/learn/${c.id}/`}>{t(c.status === 'Completed' ? 'Review course' : c.status === 'In progress' ? 'Continue course' : 'Start course')}</a>{c.certificate&&<a href={'/certificates/'+c.certificate.token+'/'}>{t("View certificate")}</a>}</div>
          </div>
        </article>
      )}</div> : !inductionPending && <p>{t("No additional courses have been assigned to you yet.")}</p>}
  </section>;
}
