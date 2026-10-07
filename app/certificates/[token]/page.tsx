import { cookies } from 'next/headers';
import { notFound,redirect } from 'next/navigation';
import { learnerForSession } from '@/lib/server';
import { certificateForToken } from '@/lib/certificate-server';
import CertificatePaper from '@/components/certificate-paper';
import { certificateStatus } from '@/lib/certificates';
import ProfileMenu from '@/components/profile-menu';
export const dynamic='force-dynamic';
export const metadata={title:'Certificate | Primark',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}) {
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(!learner)redirect('/');
  const record=await certificateForToken((await params).token);
  if(!record||record.learner_id!==learner.id)notFound();
  return <div className="shell"><header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a><ProfileMenu/></header><main className="certificates-main">
    {certificateStatus(record.expires_at)==='Expired'&&<p className="certificate-alert no-print">This certificate has expired. Contact your manager to arrange renewal.</p>}
    <CertificatePaper record={record}/>
  </main></div>;
}
