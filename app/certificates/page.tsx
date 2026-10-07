import {CertificateList} from '@/components/certificate-pages';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { learnerForSession } from '@/lib/server';
import { certificatesFor } from '@/lib/certificate-server';
import './certificates.css';
export const dynamic='force-dynamic';
export const metadata={title:'My certificates | Primark',robots:{index:false,follow:false}};
export default async function Page() {
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(!learner)redirect('/');
  const records=(await certificatesFor(learner.id)).results;
  return <CertificateList records={records}/>;
}
