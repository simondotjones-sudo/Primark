import { certificateForToken } from '@/lib/certificate-server';
import { certificateDate,certificateStatus,certificateId } from '@/lib/certificates';
import { Check,ShieldCheck,Clock3 } from 'lucide-react';
import '../../certificates/certificates.css';
export const dynamic='force-dynamic';
export const metadata={title:'Verify certificate | Primark',robots:{index:false,follow:false}};
export default async function Verify({params}:{params:Promise<{token:string}>}) {
  const record=await certificateForToken((await params).token);
  const status=record?certificateStatus(record.expires_at):null;
  return <main className="verify-page"><div className="verify-card"><div className="verify-brand">PRIMARK <span>Certificate verification</span></div>{record?<>
    <div className={'verify-tick is-'+status?.toLowerCase().replaceAll(' ','-')}>{status==='Valid'?<Check size={45}/>:<Clock3 size={45}/>}</div>
    <span className="eyebrow">LIVE CERTIFICATE RECORD</span><h1>{status==='Expired'?'Certificate expired':'Certificate verified'}</h1>
    <span className={'certificate-status is-'+status?.toLowerCase().replaceAll(' ','-')}>{status}</span>
    <dl><div><dt>Certificate ID</dt><dd>{certificateId(record.certificate_number)}</dd></div><div><dt>Name</dt><dd dir="auto">{record.learner_name}</dd></div><div><dt>Course</dt><dd dir="auto">{record.course_title}</dd></div><div><dt>Completed</dt><dd>{certificateDate(record.completed_at)}</dd></div><div><dt>Expires</dt><dd>{certificateDate(record.expires_at)}</dd></div></dl>
    <p>{status==='Expired'?'This records a past completion. Renewal is required.':'This certificate matches a recorded course completion.'}</p>
  </>:<><ShieldCheck size={48}/><h1>Certificate not found</h1><p>We could not verify a certificate with this code.</p></>}</div></main>;
}
