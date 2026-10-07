'use client';
import { useEffect,useState } from 'react';
import { Check,Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { certificateDate,certificateStatus,certificateId,type Certificate } from '@/lib/certificates';
import stores from '@/lib/stores.json';
import '@/app/certificates/certificates.css';

export default function CertificatePaper({record,sample=false}:{record:Certificate;sample?:boolean}) {
  const [qr,setQr]=useState(''),[qrError,setQrError]=useState(false);
  const status=certificateStatus(record.expires_at);
  const verifyPath='/verify/'+record.token+'/';
  useEffect(()=>{
    if(sample)return;
    let active=true;
    QRCode.toDataURL(location.origin+verifyPath,{margin:1,width:240,errorCorrectionLevel:'M',color:{dark:'#163746',light:'#ffffff'}})
      .then(value=>{if(active)setQr(value);}).catch(()=>{if(active)setQrError(true);});
    return ()=>{active=false;};
  },[verifyPath,sample]);
  return <section className="certificate-view">
    <div className="certificate-toolbar no-print"><a href="/certificates/">All certificates</a><button className="certificate-print" onClick={()=>window.print()} disabled={!sample&&!qr&&!qrError}><Printer size={17}/>Print / Save PDF</button></div>
    <article className="certificate-paper" aria-label="Certificate of completion">
      <div className="certificate-masthead"><strong>PRIMARK</strong><span>LEARNING & DEVELOPMENT</span></div>
      <div className="certificate-content">
        <div className="certificate-kicker"><span className="certificate-seal"><Check size={22}/></span>Certificate of completion</div>
        <p className="certificate-awarded">Awarded to</p>
        <h1 dir="auto">{record.learner_name}</h1>
        <p className="certificate-for">for successfully completing</p>
        <h2 dir="auto">{record.course_title}</h2>
        <p className="certificate-location">{stores.find(s=>s.id===record.store_id)?.name||record.store_id} · {record.country}</p>
        <dl className="certificate-dates"><div><dt>Completed</dt><dd>{certificateDate(record.completed_at)}</dd></div><div><dt>Expires</dt><dd>{certificateDate(record.expires_at)}</dd></div></dl>
        <div className="certificate-footer">
          <div><span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{sample?'Sample certificate':status}</span><p className="certificate-id">Certificate ID<br/><bdi>{certificateId(record.certificate_number)}</bdi></p></div>
          {!sample&&<a className="certificate-verification" href={verifyPath}>{qr&&<img src={qr} width={90} height={90} alt="QR code to verify this certificate"/>}<span>Scan to verify<br/><small>View the live record</small></span></a>}
          {sample&&<span className="certificate-sample">DESIGN PREVIEW</span>}
        </div>
      </div>
    </article>
  </section>;
}
