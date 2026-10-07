'use client';
import {Check,ShieldCheck,Clock3} from 'lucide-react';
import {useLanguage,LanguagePicker} from '@/components/language-provider';
import {certificateStatus,certificateId,type Certificate} from '@/lib/certificates';
import ProfileMenu from '@/components/profile-menu';
import CertificatePaper from '@/components/certificate-paper';
import '@/app/certificates/certificates.css';

function Header(){return <header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a><div className="top-controls"><ProfileMenu/></div></header>;}
export function CertificateList({records}:{records:Certificate[]}){
 const {t,date}=useLanguage();
 return <div className="shell"><Header/><main className="certificates-main"><div className="certificates-heading"><h1>{t('My certificates')}</h1><a href="/?courses=1">{t('Back to My courses')}</a></div>
 {records.length?<div className="certificate-list">{records.map(r=>{const status=certificateStatus(r.expires_at);return <a className="certificate-card" key={r.token} href={'/certificates/'+r.token+'/'}><span className={'certificate-status is-'+status.toLowerCase().replaceAll(' ','-')}>{t(status)}</span><h2 dir="auto">{r.course_title}</h2><p>{t('Completed {date}',{date:date(r.completed_at)})}<br/>{r.expires_at?t('Expires {date}',{date:date(r.expires_at)}):t('No expiry')}</p><strong>{t('View certificate')} →</strong></a>;})}</div>:<div className="certificates-empty">{t('Your certificates will appear here when you complete a course.')}</div>}
 </main></div>;
}
export function CertificateDetail({record}:{record:Certificate}){const {t}=useLanguage();return <div className="shell"><Header/><main className="certificates-main">{certificateStatus(record.expires_at)==='Expired'&&<p className="certificate-alert no-print">{t('This certificate has expired. Contact your manager to arrange renewal.')}</p>}<CertificatePaper record={record}/></main></div>;}
export function CertificateVerification({record}:{record:Certificate|null}){
 const {t,date}=useLanguage(),status=record?certificateStatus(record.expires_at):null;
 return <main className="verify-page"><div className="verify-language no-print"><LanguagePicker/></div><div className="verify-card"><div className="verify-brand"><bdi>PRIMARK</bdi> <span>{t('Certificate verification')}</span></div>{record?<><div className={'verify-tick is-'+status?.toLowerCase().replaceAll(' ','-')}>{status==='Valid'?<Check size={45}/>:<Clock3 size={45}/>}</div><span className="eyebrow">{t('LIVE CERTIFICATE RECORD')}</span><h1>{t(status==='Expired'?'Certificate expired':'Certificate verified')}</h1><span className={'certificate-status is-'+status?.toLowerCase().replaceAll(' ','-')}>{t(status!)}</span><dl><div><dt>{t('Certificate ID')}</dt><dd>{certificateId(record.certificate_number)}</dd></div><div><dt>{t('Name')}</dt><dd dir="auto">{record.learner_name}</dd></div><div><dt>{t('Course')}</dt><dd dir="auto">{record.course_title}</dd></div><div><dt>{t('Completed')}</dt><dd>{date(record.completed_at)}</dd></div><div><dt>{t('Expires')}</dt><dd>{record.expires_at?date(record.expires_at):t('No expiry')}</dd></div></dl><p>{t(status==='Expired'?'This records a past completion. Renewal is required.':'This certificate matches a recorded course completion.')}</p></>:<><ShieldCheck size={48}/><h1>{t('Certificate not found')}</h1><p>{t('We could not verify a certificate with this code.')}</p></>}</div></main>;
}
