'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {useLanguage} from '@/components/language-provider';
import {useFeatures} from '@/hooks/use-features';
import {emailLabels} from '@/lib/email-types';
import type {ReportSchedule} from '@/lib/scheduled-reports';
import type {DirectoryStore} from '@/lib/store-directory';
export default function ScheduledReports({schedules,stores,busy,action,enabled}:{schedules:ReportSchedule[];stores:DirectoryStore[];busy:boolean;enabled:string[];action:(body:Record<string,unknown>)=>Promise<boolean>}){
 const {t}=useLanguage(),features=useFeatures();
 return <><section className="paper course-editor"><h2>{t('Scheduled reports')}</h2><p>{t('Choose a day, time and timezone. Delivery requires live email.')}</p><p>{t('Enable reports in Settings → Reporting & compliance.')}</p><a href="/admin/settings">{t('Feature settings')}</a><p>{t('Current records only. Archived learners and inactive stores are excluded.')}</p></section>
 {schedules.map(schedule=><Schedule key={schedule.kind+':'+schedule.revision} schedule={schedule} stores={stores} busy={busy} action={action} active={!!features[schedule.kind==='manager_digest'?'weekly_store_reports':'monthly_country_reports']} templateEnabled={enabled.includes(schedule.kind)}/>)}</>;
}
function Schedule({schedule,stores,busy,action,active,templateEnabled}:{schedule:ReportSchedule;stores:DirectoryStore[];busy:boolean;action:(body:Record<string,unknown>)=>Promise<boolean>;active:boolean;templateEnabled:boolean}){
 const {t}=useLanguage(),[value,setValue]=useState(schedule),[scope,setScope]=useState('');
 const weekly=schedule.kind==='manager_digest',days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const activeStores=stores.filter(s=>s.active),countries=[...new Set(activeStores.map(s=>s.country))];
 return <section className="paper course-editor"><h2>{t(emailLabels[schedule.kind])}</h2>
 <p>{t(weekly?'Store managers receive their store’s overdue list (up to 50 rows).':'Organisation and country admins receive summaries for their countries.')}</p>
 <p role="status">{t(!active?'This feature is switched off in Settings.':!templateEnabled?'This report template is disabled in Email settings.':'Report enabled. Delivery requires live email.')}</p>
 <form onSubmit={e=>{e.preventDefault();void action({action:'report_schedule',...value});}}><fieldset disabled={busy||!active}><div className="email-fields">
 <label>{t(weekly?'Day of week':'Day of month')}<NativeSelect value={weekly?value.weekday:value.monthday} onChange={e=>setValue({...value,[weekly?'weekday':'monthday']:Number(e.target.value)})}>{weekly?days.map((d,i)=><option value={i+1} key={d}>{t(d)}</option>):Array.from({length:28},(_,i)=><option value={i+1} key={i}>{i+1}</option>)}</NativeSelect></label>
 <label>{t('Time')}<NativeSelect value={value.hour} onChange={e=>setValue({...value,hour:Number(e.target.value)})}>{Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}:00</option>)}</NativeSelect></label>
 <label>{t('Timezone')}<Input required list={weekly?'report-timezones':'country-timezones'} value={value.timezone} onChange={e=>setValue({...value,timezone:e.target.value})}/><datalist id={weekly?'report-timezones':'country-timezones'}>{['Europe/London','Europe/Dublin','Europe/Paris','Europe/Berlin','Europe/Madrid','America/New_York','America/Chicago','UTC'].map(z=><option key={z} value={z}/>)}</datalist></label>
 </div><p className="access-note">{t('Local time adjusts for daylight saving. Monthly reports use days 1–28.')}</p><Button disabled={busy||!active}>{t('Save schedule')}</Button></fieldset></form>
 <div className="email-preview-controls"><label>{t(weekly?'Store':'Country')}<NativeSelect value={scope} onChange={e=>setScope(e.target.value)}><option value="">{t('Choose a report scope.')}</option>{weekly?activeStores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.country}</option>):countries.map(c=><option key={c} value={c}>{c}</option>)}</NativeSelect></label><Button variant="outline" disabled={busy||!active||!scope} onClick={()=>void action({action:'report_preview',kind:schedule.kind,scope})}>{t('Preview current report')}</Button></div><p className="access-note">{t('Preview uses current records. Nothing is sent or queued.')}</p>
 </section>;
}
