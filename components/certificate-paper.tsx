'use client';
import {useLanguage} from '@/components/language-provider';
import { useEffect,useState } from 'react';
import { Check,Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { certificateStatus,certificateId,type Certificate } from '@/lib/certificates';
import stores from '@/lib/stores.json';
import '@/app/certificates/certificates.css';

export default function CertificatePaper({record,sample=false}:{record:Certificate;sample?:boolean}) {
  const {t,lang,country:countryLabel,date}=useLanguage();

  const [qr,setQr]=useState(''),[qrError,setQrError]=useState(false);
  const status=record.cancelled_at?'Revoked':certificateStatus(record.expires_at);
  const verifyPath='/verify/'+record.token+'/?lang='+lang;
  useEffect(()=>{
    if(sample)return;
    let active=true;
    QRCode.toDataURL(location.origin+verifyPath,{margin:1,width:240,errorCorrectionLevel:'M',color:{dark:'#163746',light:'#ffffff'}})
      .then(value=>{if(active)setQr(value);}).catch(()=>{if(active)setQrError(true);});
    return ()=>{active=false;};
  },[verifyPath,sample]);
  return <section className="certificate-view">
    <div className="certificate-toolbar no-print"><a href="/certificates/">{t("All certificates")}</a><button className="certificate-print" onClick={()=>window.print()} disabled={!sample&&!qr&&!qrError}><Printer size={17}/>{t("Print / Save PDF")}</button></div>
    <article className="certificate-paper" aria-label={t("Certificate of completion")}>
      <div className="certificate-masthead"><strong>PRIMARK</strong><span>{t("LEARNING & DEVELOPMENT")}</span></div>
      <div className="certificate-content">
        <div className="certificate-kicker"><span className="certificate-seal"><Check size={22}/></span>{t("Certificate of completion")}</div>
        <p className="certificate-awarded">{t("Awarded to")}</p>
        <h1 dir="auto">{record.learner_name}</h1>
        <p className="certificate-for">{t("for successfully completing")}</p>
        <h2 dir="auto">{record.course_title}</h2>
        <p className="certificate-location">{stores.find(s=>s.id===record.store_id)?.name||record.store_id} · {countryLabel(record.country)}</p>
        <dl className="certificate-dates"><div><dt>{t("Completed")}</dt><dd>{date(record.completed_at)}</dd></div><div><dt>{t("Expires")}</dt><dd>{record.expires_at?date(record.expires_at):t('No expiry')}</dd></div></dl>
        {record.assessor_name&&<p>{t("Practical assessment:")} {record.assessor_name} · {date(record.assessed_at||record.completed_at)}</p>}
        <div className="certificate-footer">
          <div><span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{t(sample?'Sample certificate':status)}</span><p className="certificate-id">{t("Certificate ID")}<br/><bdi>{certificateId(record.certificate_number)}</bdi></p></div>
          {!sample&&<a className="certificate-verification" href={verifyPath}>{qr&&<img src={qr} width={90} height={90} alt={t("QR code to verify this certificate")}/>}<span>{t("Scan to verify")}<br/><small>{t("View the live record")}</small></span></a>}
          {sample&&<span className="certificate-sample">{t("DESIGN PREVIEW")}</span>}
        </div>
      </div>
    </article>
  </section>;
}
