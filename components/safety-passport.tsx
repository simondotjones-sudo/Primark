'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Check,Clock3} from 'lucide-react';
import QRCode from 'qrcode';
import {useLanguage} from '@/components/language-provider';
import {certificateId,certificateStatus} from '@/lib/certificates';
import type {SafetyPassportRecord} from '@/lib/safety-passport';
import './safety-passport.css';

export default function SafetyPassport({record}:{record:SafetyPassportRecord}) {
 const {t,date,lang,country}=useLanguage();
 const status=certificateStatus(record.expires_at),expired=status==='Expired';
 const verifyPath='/verify/'+record.token+'/?lang='+lang;
 const [qr,setQr]=useState('');
 useEffect(()=>{
  let active=true;setQr('');
  QRCode.toDataURL(location.origin+verifyPath,{margin:1,width:192,errorCorrectionLevel:'M',color:{dark:'#173d4b',light:'#ffffff'}})
   .then(value=>{if(active)setQr(value);}).catch(()=>{});
  return()=>{active=false;};
 },[verifyPath]);
 return <aside className={'safety-passport'+(expired?' is-expired':'')} aria-label={t('Primark Safety Passport')}>
  <header className="safety-passport-header">
   <div><p className="safety-passport-eyebrow">{t('Safety Induction')}</p><h3>{t('Primark Safety Passport')}</h3></div>
   <span className="safety-passport-seal" role="img" aria-label={t(expired?'Certificate expired':'Certificate verified')}>
    {expired?<Clock3 size={34} strokeWidth={1.8}/>:<Check size={36} strokeWidth={2}/>}</span>
  </header>
  <div className="safety-passport-holder">
   <p className="safety-passport-label">{t('Awarded to')}</p>
   <p className="safety-passport-name" dir="auto">{record.learner_name}</p>
   <p className="safety-passport-label">{t('for successfully completing')}</p>
   <p className="safety-passport-course" dir="auto">{record.course_title}</p>
   <p className="safety-passport-location"><span dir="auto">{record.store_name}</span><span aria-hidden="true"> · </span>{country(record.country)}</p>
  </div>
  <dl className="safety-passport-dates">
   <div><dt>{t('Completed')}</dt><dd>{date(record.completed_at)}</dd></div>
   <div><dt>{t('Expires')}</dt><dd>{record.expires_at?date(record.expires_at):t('No expiry')}</dd></div>
  </dl>
  <div className="safety-passport-proof">
   <div><span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{t(status)}</span>
    <p className="safety-passport-id">{t('Certificate ID')}<bdi>{certificateId(record.certificate_number)}</bdi></p>
   </div>
   <a className="safety-passport-verify" href={verifyPath}>
    {qr&&<img src={qr} width={80} height={80} alt={t('QR code to verify this certificate')}/>}
    <span>{t('Scan to verify')}</span>
   </a>
  </div>
  <a className="safety-passport-link" href={'/certificates/'+record.token+'/'}>{t('View certificate')}<ArrowUpRight size={17} aria-hidden="true"/></a>
 </aside>;
}
