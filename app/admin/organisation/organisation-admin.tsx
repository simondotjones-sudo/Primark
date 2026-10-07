'use client';
import {useEffect,useState} from 'react';
import AdminSummary from '@/components/admin-summary';
import PageHeader from '@/components/page-header';
import {useLanguage} from '@/components/language-provider';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import type {DirectoryStore} from '@/lib/store-directory';
export default function OrganisationAdmin(){
 const {t,country:countryLabel}=useLanguage();
 const [loaded,setLoaded]=useState(false);
 const [stores,setStores]=useState<DirectoryStore[]>([]),[name,setName]=useState(''),[country,setCountry]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<DirectoryStore|null>(null);
 useEffect(()=>{fetch('/api/admin/organisation',{cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setStores(data.stores);setLoaded(true);}).catch(e=>setError(e.message));},[]);
 async function change(body:object){setBusy(true);setError('');try{const r=await fetch('/api/admin/organisation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);setStores(data.stores);setPending(null);if('name' in body){setName('');setCountry('');}}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 return <div className="shell course-admin"><PageHeader title={t("Organisation")} view="organisation"/><main className="main">
 {error&&<p className="error" role="alert">{t(error)}</p>}
 {loaded&&<AdminSummary items={[{label:t('Stores'),value:stores.length},{label:t('Active'),value:stores.filter(s=>s.active).length,blue:true},{label:t('Countries'),value:new Set(stores.filter(s=>s.active).map(s=>s.country)).size},{label:t('Archived'),value:stores.filter(s=>!s.active).length}]}/>}
 <section className="paper course-editor"><h2>{t('Add store')}</h2><form className="organisation-form" onSubmit={e=>{e.preventDefault();void change({action:'add',name,country});}}><label>{t('Country')}<Input required maxLength={80} list="organisation-countries" value={country} onChange={e=>setCountry(e.target.value)}/></label><datalist id="organisation-countries">{[...new Set(stores.map(s=>s.country))].sort().map(c=><option key={c} value={c}/>)}</datalist><label>{t('Store')}<Input required maxLength={150} value={name} onChange={e=>setName(e.target.value)}/></label><Button disabled={busy} className="blue-button">{t('Add store')}</Button></form></section>
 <section className="paper course-editor"><h2>{t('Stores')}</h2><Input type="search" aria-label={t('Search stores')} placeholder={t('Search stores')} value={search} onChange={e=>setSearch(e.target.value)}/>
 {pending&&<div className="auth-notice" role="alert"><p>{t('Archive this store? Training records are retained.')}{' '}<strong>{pending.name}</strong></p><Button disabled={busy} onClick={()=>void change({action:'archive',id:pending.id})}>{t('Archive store')}</Button><Button disabled={busy} variant="outline" onClick={()=>setPending(null)}>{t('Cancel')}</Button></div>}
 <div className="organisation-stores">{stores.filter(s=>(s.name+' '+s.country).toLowerCase().includes(search.toLowerCase())).map(s=><div key={s.id} className="organisation-store"><div><strong>{s.name}</strong><small>{countryLabel(s.country)} · {t(s.active?'Active':'Archived')}</small></div><Button variant="outline" disabled={busy} onClick={()=>s.active?setPending(s):void change({action:'restore',id:s.id})}>{t(s.active?'Archive':'Restore')}</Button></div>)}</div></section></main></div>;
}
