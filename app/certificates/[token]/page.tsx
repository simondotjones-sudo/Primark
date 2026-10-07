import {CertificateDetail} from '@/components/certificate-pages';
import { cookies } from 'next/headers';
import { notFound,redirect } from 'next/navigation';
import { learnerForSession } from '@/lib/server';
import { certificateForToken } from '@/lib/certificate-server';
export const dynamic='force-dynamic';
export const metadata={title:'Certificate | Primark',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}) {
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(!learner)redirect('/');
  const record=await certificateForToken((await params).token);
  if(!record||record.learner_id!==learner.id)notFound();
  return <CertificateDetail record={record}/>;
}
