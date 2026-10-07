import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { learnerForSession } from '@/lib/server';
import { certificatesFor } from '@/lib/certificate-server';
import { certificateDate,certificateStatus } from '@/lib/certificates';
import ProfileMenu from '@/components/profile-menu';
import './certificates.css';
export const dynamic='force-dynamic';
export const metadata={title:'My certificates | Primark',robots:{index:false,follow:false}};
export default async function Page() {
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(!learner)redirect('/');
  const records=(await certificatesFor(learner.id)).results;
  return <div className="shell"><header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a><ProfileMenu/></header><main className="certificates-main">
    <div className="certificates-heading"><h1>My certificates</h1><a href="/?courses=1">Back to My courses</a></div>
    {records.length?<div className="certificate-list">{records.map(r=>{const status=certificateStatus(r.expires_at);return <a className="certificate-card" key={r.token} href={'/certificates/'+r.token+'/'}><span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{status}</span><h2>{r.course_title}</h2><p>Completed {certificateDate(r.completed_at)}<br/>{r.expires_at?'Expires '+certificateDate(r.expires_at):'No expiry'}</p><strong>View certificate →</strong></a>;})}</div>:<div className="certificates-empty">Your certificates will appear here when you complete a course.</div>}
  </main></div>;
}
