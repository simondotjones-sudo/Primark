'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/components/language-provider';
import type {OrganisationSettings as Settings} from '@/lib/organisation-settings';
export default function OrganisationSettings(){
 const {t}=useLanguage(),[settings,setSettings]=useState<Settings|null>(null),[credits,setCredits]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{const controller=new AbortController();fetch('/api/admin/settings',{signal:controller.signal,cache:'no-store'}).then(async r=>{
  if(r.status===403)return;const d=await r.json();if(!r.ok)throw new Error(d.error);setSettings(d.settings);setCredits(d.canSetCredits);
 }).catch(e=>{if(e.name!=='AbortError')setMessage(e.message);});return()=>controller.abort();},[]);
 if(!settings)return message?<p role="alert">{t(message)}</p>:null;
 async function save(){
  setBusy(true);setMessage('');try{
   const {credits_enabled,...rest}=settings!;
   const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...rest,...(credits?{credits_enabled}:{})})}),d=await r.json();
   if(!r.ok)throw new Error(d.error);setSettings(d.settings);setMessage('Organisation settings saved.');
  }catch(e){setMessage(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <section className="paper course-editor organisation-settings"><h2>{t('Organisation settings')}</h2>
 <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy}>
 {credits&&<div><label><input type="checkbox" checked={settings.credits_enabled} onChange={e=>setSettings({...settings,credits_enabled:e.target.checked})}/>{t('Use course credits')}</label><p>{t('When off, new assignments and renewals are free of credit charges. Previous charges, balances and training history are retained.')}</p></div>}
 <div><label><input type="checkbox" checked={settings.auto_archive_enabled} onChange={e=>setSettings({...settings,auto_archive_enabled:e.target.checked})}/>{t('Automatically archive learners inactive for three years')}</label><p>{t('Retains training history and allows restoration. Admin accounts are excluded. Unknown historic login dates need three years of observation before archiving.')}</p></div>
 <div><label><input type="checkbox" checked={settings.exclude_within_deadline} onChange={e=>setSettings({...settings,exclude_within_deadline:e.target.checked})}/>{t('Exclude unfinished courses within their deadline from compliance')}</label><p>{t('Expired certificates still count. Courses without a deadline count immediately. Within-deadline work is shown separately.')}</p></div>
 </fieldset><Button disabled={busy} className="blue-button">{t(busy?'Saving…':'Save settings')}</Button>{message&&<p role="status">{t(message)}</p>}</form>
 </section>;
}
