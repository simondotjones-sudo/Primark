'use client';
import { useEffect, useState } from 'react';
import CourseCover from '@/components/course-cover';
import type { CourseCoverKey } from '@/lib/course-covers';
type AssignedCourse = {
  id: string; title: string; description: string; coverKey: CourseCoverKey;
  status: 'Not started' | 'In progress' | 'Completed';
  progressPercent: number | null;
  scos: {id: string; title: string; status: string; score: string | null}[];
};

export default function AssignedCourses() {
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
    <div className="section-title"><h2>Assigned courses</h2></div>
    {inductionPending && <p>Your induction is being prepared. It will appear here when it is available.</p>}
    {error ? <p role="alert">{error}</p> : courses === null ? <p>Loading your courses…</p> : courses.length ?
      <div className="course-catalog-grid">{courses.map(c =>
        <a className="paper assigned-course" key={c.id} href={`/learn/${c.id}/`}>
          <div className="assigned-course-cover"><CourseCover coverKey={c.coverKey}
            sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1340px) calc(50vw - 178px), 480px" /></div>
          <div className="assigned-course-details">
          <span className={'status ' + (c.status === 'Completed' ? 'done' : '')}>
            {c.status === 'In progress' && c.progressPercent != null ? `${c.progressPercent}% complete` : c.status}
          </span>
          <h3>{c.title}</h3>
          <p>{c.description || `${c.scos.length} lessons`}</p>
          <strong>{c.status === 'Completed' ? 'Review course' : c.status === 'In progress' ? 'Continue course' : 'Start course'}</strong>
          </div>
        </a>
      )}</div> : !inductionPending && <p>No additional courses have been assigned to you yet.</p>}
  </section>;
}
