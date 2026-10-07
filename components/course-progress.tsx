import { CircleCheck } from 'lucide-react';

export default function CourseProgress({ status, percent, title }: {
  status: 'Not started' | 'In progress' | 'Completed'; percent: number | null; title: string;
}) {
  const completed = status === 'Completed';
  const value = completed ? 100 : status === 'Not started' ? 0
    : typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent) : null;
  return <span className={'course-progress' + (completed ? ' is-complete' : '')}>
    <span className="course-progress-label">
      <span>{completed && <CircleCheck size={16} aria-hidden="true"/>}{status}</span>
      {status === 'In progress' && value !== null && <span>{value}% complete</span>}
    </span>
    {value !== null && <progress max={100} value={value} aria-label={`${title}: ${status}`} />}
  </span>;
}
