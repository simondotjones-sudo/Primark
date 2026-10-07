import {CertificateVerification} from '@/components/certificate-pages';
import { certificateForToken } from '@/lib/certificate-server';
import '../../certificates/certificates.css';
export const dynamic='force-dynamic';
export const metadata={title:'Verify certificate | Primark',robots:{index:false,follow:false}};
export default async function Verify({params}:{params:Promise<{token:string}>}) {
  const record=await certificateForToken((await params).token);
  return <CertificateVerification record={record}/>;
}
