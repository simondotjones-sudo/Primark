'use client';
import {useEffect,useState} from 'react';
import {BookOpen,ClipboardCheck,Users,Mail,BarChart3,LockKeyhole,Search,Check,Settings2} from 'lucide-react';
import PageHeader from '@/components/page-header';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {useLanguage} from '@/components/language-provider';
import {featureCatalogue,effectiveFeature,type FeatureChoices,type FeatureId,type FeaturePolicy} from '@/lib/feature-catalogue';
type Data={choices:FeatureChoices;revision:number;platformAdmin:boolean;organisation:string};
const categories=[...new Set(featureCatalogue.map(f=>f.category))];
const icons=[BookOpen,ClipboardCheck,Users,Mail,BarChart3];
export default function FeatureSettings(){
 const {t}=useLanguage(),[data,setData]=useState<Data|null>(null),[saved,setSaved]=useState<FeatureChoices|null>(null),[category,setCategory]=useState('All features'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){setError('');try{const r=await fetch('/api/admin/settings',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);setSaved(structuredClone(d.choices));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 const dirty=!!data&&JSON.stringify(data.choices)!==JSON.stringify(saved);
 useEffect(()=>{if(!dirty)return;const prevent=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty]);
 function update(id:FeatureId,patch:Partial<FeatureChoices[FeatureId]>){setNotice('');setData(d=>d?{...d,choices:{...d.choices,[id]:{...d.choices[id],...patch}}}:d);}
 async function save(){if(!data||!saved)return;setBusy(true);setError('');setNotice('');try{
  const changes=Object.fromEntries(featureCatalogue.filter(f=>JSON.stringify(data.choices[f.id])!==JSON.stringify(saved[f.id])).map(f=>[f.id,data.platformAdmin?data.choices[f.id]:{enabled:data.choices[f.id].enabled}]));
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:data.revision,changes})}),d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);setSaved(structuredClone(d.choices));setNotice('Settings saved.');window.dispatchEvent(new Event('features-updated'));
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const visible=featureCatalogue.filter(f=>(category==='All features'||category===f.category)&&`${f.name} ${f.description}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="shell course-admin"><PageHeader title={t('Settings')} view="settings"/><main className="main feature-settings">
 <div className="feature-intro"><div className="feature-symbol"><Settings2 size={25}/></div><div><span className="feature-eyebrow">{data?.organisation||'Primark'}</span><h2>{t('Make the platform work for your organisation')}</h2><p>{t(data?.platformAdmin?'Choose which features are disabled, optional or required.':'Switch optional features on or off for your organisation.')}</p></div></div>
 {error&&<div className="feature-error" role="alert">{t(error)} <Button variant="outline" disabled={busy} onClick={()=>void load()}>{t('Reload settings')}</Button></div>}
 {notice&&<p className="feature-notice" role="status"><Check size={18}/>{t(notice)}</p>}
 {!data?<p role="status">{t('Loading…')}</p>:<>
 <div className="feature-toolbar"><div className="feature-search"><Search size={18}/><Input aria-label={t('Search features')} placeholder={t('Search features…')} value={search} onChange={e=>setSearch(e.target.value)}/></div><span>{featureCatalogue.filter(f=>effectiveFeature(data.choices,f.id)).length} / {featureCatalogue.length} {t('active')}</span></div>
 <nav className="feature-tabs" aria-label={t('Feature categories')}>{['All features',...categories].map(c=><button key={c} type="button" aria-pressed={category===c} onClick={()=>setCategory(c)}>{t(c)}</button>)}</nav>
 <div className="feature-list">{categories.map((c,index)=>{const rows=visible.filter(f=>f.category===c);if(!rows.length)return null;const Icon=icons[index];return <section className="paper feature-category" key={c}><h2><Icon size={20}/>{t(c)}<span>{rows.length}</span></h2>{rows.map(f=>{
 const choice=data.choices[f.id],active=effectiveFeature(data.choices,f.id),parentOff='parent' in f&&!effectiveFeature(data.choices,f.parent),locked=choice.policy!=='optional';
 return <div className="feature-row" key={f.id}><div className="feature-copy"><h3>{t(f.name)}</h3><p>{t(f.description)}</p>{parentOff&&<small>{t('Requires')}: {t(featureCatalogue.find(p=>'parent' in f&&p.id===f.parent)!.name)}</small>}</div><div className="feature-controls">
 {data.platformAdmin&&<label className="feature-policy"><span>{t('Platform access')}</span><NativeSelect disabled={busy} aria-label={`${t(f.name)} — ${t('Platform access')}`} value={choice.policy} onChange={e=>update(f.id,{policy:e.target.value as FeaturePolicy})}><option value="disabled">{t('Disabled')}</option><option value="optional">{t('Optional')}</option><option value="required">{t('Required')}</option></NativeSelect></label>}
 <div className="feature-state"><button type="button" className="feature-switch" role="switch" aria-checked={active} aria-label={t(f.name)} disabled={busy||locked||parentOff} onClick={()=>update(f.id,{enabled:!choice.enabled})}><span/></button><span>{t(active?'On':'Off')}</span></div>
 {locked&&<small className="feature-lock"><LockKeyhole size={12}/>{t(choice.policy==='required'?'Required by Platform Admin':'Managed by Platform Admin')}</small>}
 </div></div>;})}</section>;})}</div>
 {!visible.length&&<p className="paper feature-empty">{t('No features match your search.')}</p>}
 <section className="feature-essential"><LockKeyhole size={18}/><div><strong>{t('Always protected')}</strong><p>{t('Permissions, audit history and existing training evidence remain protected. Existing quiz and assessor requirements continue to apply.')}</p></div></section>
 <div className="feature-save"><span>{t(dirty?'You have unsaved changes.':'All changes saved.')}</span><Button variant="outline" disabled={busy||!dirty} onClick={()=>{setData({...data,choices:structuredClone(saved!)});setError('');}}>{t('Discard changes')}</Button><Button className="blue-button" disabled={busy||!dirty} onClick={()=>void save()}>{t(busy?'Saving…':'Save settings')}</Button></div>
 </>}
 </main></div>;
}
