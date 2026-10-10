'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {JobRole} from '@/lib/job-role-types';
export default function JobRoleSettings(){
 const {t}=useLanguage();const [roles,setRoles]=useState<JobRole[]>([]),[loaded,setLoaded]=useState(false),[draft,setDraft]=useState<JobRole|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/job-roles',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);setRoles(d.roles);setLoaded(true);}
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);
 async function save(role:JobRole){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/job-roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...role,id:role.id||undefined})}),d=await r.json();if(!r.ok)throw Error(d.error);setRoles(d.roles);setDraft(null);setNotice('Job roles saved.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="paper job-role-settings"><div className="job-role-heading"><div><h2>{t('Job roles')}</h2><p>{t('Define job roles for your organisation. Administrators assign them to users; they do not change system permissions.')}</p></div><Button variant="outline" disabled={busy||!loaded} onClick={()=>{setDraft({id:'',name:'',external_code:null,archived:false,revision:0});setNotice('');}}>{t('Add job role')}</Button></div>
 {error&&<p className="feature-error" role="alert">{t(error)} <Button variant="outline" disabled={busy} onClick={()=>load().then(()=>{setError('');setDraft(null);}).catch(e=>setError(e.message))}>{t('Reload')}</Button></p>}{notice&&<p className="feature-notice" role="status">{t(notice)}</p>}
 {!loaded&&!error&&<p>{t('Loading…')}</p>}
 {draft?<form onSubmit={e=>{e.preventDefault();void save(draft);}}><fieldset disabled={busy} className="job-role-form"><label>{t('Role name')}<Input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>{t('Payroll code (optional)')}<Input maxLength={100} value={draft.external_code||''} onChange={e=>setDraft({...draft,external_code:e.target.value||null})}/></label><Button className="blue-button">{t(busy?'Saving…':'Save job role')}</Button><Button type="button" variant="outline" onClick={()=>setDraft(null)}>{t('Cancel')}</Button></fieldset></form>:<div className="job-role-list">{roles.map(role=><div className="job-role-row" key={role.id}><div><strong>{role.name}</strong><small>{role.external_code?`${t('Payroll code')}: ${role.external_code} · `:''}{role.users||0} {t('Users')}{role.archived?' · '+t('Archived'):''}</small></div><div><Button variant="outline" disabled={busy} onClick={()=>setDraft({...role})}>{t('Edit')}</Button><Button variant="outline" disabled={busy} onClick={()=>void save({...role,archived:!role.archived})}>{t(role.archived?'Restore':'Archive')}</Button></div></div>)}</div>}
 <p className="job-role-note">{t('Archived roles remain on existing users and assignment rules, but cannot be selected for new users. Payroll codes are reserved for a future integration; no payroll connection is active.')}</p></section>;
}
