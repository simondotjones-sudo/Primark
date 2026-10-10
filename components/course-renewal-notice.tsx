'use client';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import type {CourseRenewal} from '@/lib/course-renewals';
import {renewalDays} from '@/lib/course-renewal-status';

export default function CourseRenewalNotice({certificate,renewal,onRenew}:{certificate:{expiresAt:string|null}|null;renewal?:CourseRenewal;onRenew:()=>void}){
 const {t,date}=useLanguage();
 const days=renewalDays(certificate?.expiresAt),refresher=renewal?.refresher;
 return <>
  {days!==null&&<div className={'course-renewal-notice'+(refresher?.status==='completed'?' is-completed':'')}>
   <strong>{t(refresher?.status==='completed'?'Refresher completed':days===0?'Certificate expired':days===1?'Expires in 1 day':'Expires in {days} days',{days})}</strong>
   {refresher?<>
    <p>{refresher.status==='completed'||refresher.status==='assigned'?t('{title} is your refresher course.',{title:refresher.title}):t('Your refresher is pending. Contact your Store Manager if it is not available.')}</p>
    {refresher.available&&<a href={`/learn/${refresher.courseId}/`}>{t('Open refresher')}</a>}
   </>:renewal?.canRenew&&<Button type="button" variant="outline" onClick={onRenew}>{t('Restart course')}</Button>}
  </div>}
  {renewal?.previousCertificate&&<p className="previous-completion"><a href={'/certificates/'+renewal.previousCertificate.token+'/'}>{t('Previous completion: {date}',{date:date(renewal.previousCertificate.completedAt)})}</a></p>}
 </>;
}
