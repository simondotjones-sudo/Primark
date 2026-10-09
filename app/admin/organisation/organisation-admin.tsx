'use client';
import {useEffect,useState,useRef} from 'react';
import AdminSummary from '@/components/admin-summary';
import PageHeader from '@/components/page-header';
import {useLanguage} from '@/components/language-provider';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {NativeSelect} from '@/components/ui/native-select';
import type {DirectoryStore} from '@/lib/store-directory';
export default function OrganisationAdmin(){
 const {t,country:countryLabel}=useLanguage();
 const [loaded,setLoaded]=useState(false),[canAddCountry,setCanAddCountry]=useState(false),[fixedCountry,setFixedCountry]=useState('');
 const [stores,setStores]=useState<DirectoryStore[]>([]),[name,setName]=useState(''),[country,setCountry]=useState(''),[newCountry,setNewCountry]=useState('');
 const [storeCode,setStoreCode]=useState(''),[adminEmail,setAdminEmail]=useState(''),[adminPassword,setAdminPassword]=useState('');
 const [filterCountry,setFilterCountry]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<DirectoryStore|null>(null);
 const [editing,setEditing]=useState<DirectoryStore|null>(null),[editCountry,setEditCountry]=useState(''),[editError,setEditError]=useState('');
 const editButton=useRef<HTMLButtonElement|null>(null);
 const feedback=useRef<HTMLDivElement>(null);
 useEffect(()=>{const controller=new AbortController();fetch('/api/admin/organisation',{cache:'no-store',signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setStores(data.stores);setCanAddCountry(data.canAddCountry);const c=data.access.scope==='country'?data.access.country:'';setFixedCountry(c);setCountry(c);setLoaded(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[]);
 useEffect(()=>{if(error||notice)feedback.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[error,notice]);
 async function change(body:{action:string;[key:string]:unknown}){
  setBusy(true);setError('');setNotice('');setEditError('');
  try{
   const r=await fetch('/api/admin/organisation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();
   if(!r.ok){
    if(body.action==='edit'&&r.status===409){
     try{const latest=await fetch('/api/admin/organisation',{cache:'no-store'});if(latest.ok)setStores((await latest.json()).stores);}catch{/* Preserve the save error if refreshing also fails. */}
    }
    throw new Error(data.error);
   }
   setStores(data.stores);setPending(null);
   if(body.action==='edit'){setEditing(null);setNotice('Store updated.');}
   if(body.action==='add'){setName('');setCountry(fixedCountry);setNewCountry('');setStoreCode('');setAdminEmail('');setAdminPassword('');setNotice(data.passwordSetupPending?'Store and admin account created. Set a password using email recovery once email is configured.':data.adminCreated?'Store and admin account created.':'Store created.');}
  }catch(e){const message=e instanceof Error?e.message:'Please try again.';if(body.action==='edit')setEditError(message);else setError(message);}
  finally{setBusy(false);}
 }
 const countries=[...new Set(stores.map(s=>s.country))].sort();
 const shown=stores.filter(s=>(!filterCountry||s.country===filterCountry)&&(s.name+' '+s.country+' '+(s.storeCode||'')).toLowerCase().includes(search.toLowerCase()));
 return <div className="shell course-admin"><PageHeader title={t('Organisation')} view="organisation"/><main className="main">
 <div ref={feedback} aria-live="polite">{error&&<p className="error" role="alert">{t(error)}</p>}{notice&&<p className="admin-success" role="status">{t(notice)}</p>}</div>
 {loaded&&<><AdminSummary items={[{label:t('Stores'),value:stores.length},{label:t('Active'),value:stores.filter(s=>s.active).length,blue:true},{label:t('Countries'),value:new Set(stores.filter(s=>s.active).map(s=>s.country)).size},{label:t('Archived'),value:stores.filter(s=>!s.active).length}]}/>
 <section className="paper course-editor"><h2>{t('Add store')}</h2><form className="organisation-form organisation-setup" onSubmit={e=>{e.preventDefault();void change({action:'add',name,country:country==='__new__'?newCountry:country,newCountry:country==='__new__',storeCode,adminEmail,adminPassword});}}>
 <fieldset disabled={busy}>
 <label>{t('Country')}<NativeSelect required value={country} disabled={!!fixedCountry} onChange={e=>setCountry(e.target.value)}><option value="">{t('Choose a country')}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}{canAddCountry&&<option value="__new__">{t('Add new country')}</option>}</NativeSelect></label>
 {country==='__new__'&&<label>{t('New country')}<Input required maxLength={80} value={newCountry} onChange={e=>setNewCountry(e.target.value)}/></label>}
 <label>{t('Store')}<Input required maxLength={150} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>{t('Store code')}<Input maxLength={50} value={storeCode} onChange={e=>setStoreCode(e.target.value)} placeholder={t('Optional')}/></label>
 <label>{t('Store admin email')}<Input type="email" maxLength={254} value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} placeholder={t('Optional')} autoComplete="off"/></label>
 {adminEmail&&<label>{t('Initial admin password')}<Input type="password" minLength={16} maxLength={128} value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} placeholder={t('Optional')} autoComplete="new-password"/></label>}
 </fieldset>
 {adminEmail&&<p className="access-note">{t('Creates a Store Manager for this store. Set an initial password, or use email recovery once email is configured.')}</p>}
 <Button disabled={busy} className="blue-button">{t(busy?'Saving…':'Add store')}</Button></form></section>
 <section className="paper course-editor"><h2>{t('Stores')}</h2><div className="organisation-store-filters"><label>{t('Country')}<NativeSelect value={filterCountry} onChange={e=>setFilterCountry(e.target.value)}><option value="">{t('All countries')}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></label><Input type="search" aria-label={t('Search stores')} placeholder={t('Search stores')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
 {pending&&<div className="auth-notice" role="alert"><p>{t('Archive this store? Training records are retained.')}{' '}<strong>{pending.name}</strong></p><Button disabled={busy} onClick={()=>void change({action:'archive',id:pending.id})}>{t('Archive store')}</Button><Button disabled={busy} variant="outline" onClick={()=>setPending(null)}>{t('Cancel')}</Button></div>}
 <div className="organisation-stores">{shown.map(s=><div key={s.id} className="organisation-store"><div><strong>{s.name}</strong><small>{countryLabel(s.country)} · {t(s.active?'Active':'Archived')}{s.storeCode?' · '+s.storeCode:''}</small>{s.adminEmail&&<small>{s.adminEmail}</small>}</div><div className="organisation-store-actions"><Button variant="outline" disabled={busy} onClick={event=>{editButton.current=event.currentTarget;setEditing({...s});setEditCountry('');setEditError('');setPending(null);}}>{t('Edit')}</Button><Button variant="outline" disabled={busy} onClick={()=>s.active?setPending(s):void change({action:'restore',id:s.id})}>{t(s.active?'Archive':'Restore')}</Button></div></div>)}</div>{!shown.length&&<p className="empty">{t('No matching stores.')}</p>}</section></>}
 </main>
 <Dialog open={!!editing} onOpenChange={open=>{if(!open&&!busy)setEditing(null);}}>
 <DialogContent className="store-details-dialog" showCloseButton={!busy} onCloseAutoFocus={event=>{event.preventDefault();editButton.current?.focus();}}>
 <DialogHeader><DialogTitle>{t('Store details')}</DialogTitle><DialogDescription>{editing?.name}</DialogDescription></DialogHeader>
 {editing&&<form className="organisation-form organisation-setup" onSubmit={event=>{event.preventDefault();void change({action:'edit',id:editing.id,revision:editing.revision??null,name:editing.name,country:editing.country==='__new__'?editCountry:editing.country,newCountry:editing.country==='__new__',storeCode:editing.storeCode||'',adminEmail:editing.adminEmail||''});}}>
 {editError&&<p className="error" role="alert">{t(editError)}</p>}
 <fieldset disabled={busy}>
 <label>{t('Store')}<Input required maxLength={150} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
 <label>{t('Store code')}<Input maxLength={50} value={editing.storeCode||''} onChange={e=>setEditing({...editing,storeCode:e.target.value})} placeholder={t('Optional')}/></label>
 <label>{t('Country')}<NativeSelect required disabled={!!fixedCountry} value={editing.country} onChange={e=>setEditing({...editing,country:e.target.value})}>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}{canAddCountry&&<option value="__new__">{t('Add new country')}</option>}</NativeSelect></label>
 {editing.country==='__new__'&&<label>{t('New country')}<Input required maxLength={80} value={editCountry} onChange={e=>setEditCountry(e.target.value)}/></label>}
 <label>{t('Store admin email')}<Input type="email" maxLength={254} value={editing.adminEmail||''} onChange={e=>setEditing({...editing,adminEmail:e.target.value})} placeholder={t('Optional')} autoComplete="off"/></label>
 <label>{t('Number of learners')}<Input readOnly value={editing.learnerCount??0} aria-describedby="store-learner-count-help"/><small id="store-learner-count-help">{t('Active learners only.')}</small></label>
 </fieldset>
 <p className="access-note">{t('Store contact only. Manage account access in Manage users.')}</p>
 <div className="store-details-actions"><Button type="button" variant="outline" disabled={busy} onClick={()=>setEditing(null)}>{t('Cancel')}</Button><Button disabled={busy} className="blue-button">{t(busy?'Saving…':'Save changes')}</Button></div>
 </form>}
 </DialogContent></Dialog>
 </div>;
}
