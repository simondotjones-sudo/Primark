'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import AdminSummary from '@/components/admin-summary';
import type {ReportingAccess} from '@/lib/reporting-types';

type Person={id:string;name:string;email:string;country:string;store_id:string;admin_only:boolean};
type Options={roles:string[];stores:{id:string;name:string;country:string}[];access:ReportingAccess;platformAdmin:boolean;canAssign:boolean};
type Data=Options&{people:Person[];total:number;pageSize:number;summary:{total:number;stores:number;countries:number}};
export default function UserDirectory({onAssign,onPermissions}:{onAssign:(person:Person)=>void;onPermissions:(options:Options)=>void}) {
  const {t,country:countryLabel}=useLanguage();
  const [data,setData]=useState<Data|null>(null),[search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[creating,setCreating]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const timer=setTimeout(()=>{fetch('/api/users?'+new URLSearchParams({search,page:String(page)}),{cache:'no-store',signal:controller.signal}).then(async r=>{
      const result=await r.json();if(!r.ok)throw new Error(result.error);return result;
    }).then(result=>{setData(result);onPermissions(result);setLoading(false);}).catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoading(false);}});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,page,refresh,onPermissions]);
  return <div className="user-directory">
    {!creating&&data?.platformAdmin&&<AdminSummary items={[{label:t('Users'),value:data.summary.total,blue:true},{label:t('Stores'),value:data.summary.stores},{label:t('Countries'),value:data.summary.countries}]}/>}
    <section className="paper user-panel">
    {error&&<p className="error" role="alert">{t(error)}</p>}
    {message&&<p className="admin-success" role="status">{t(message)}</p>}
    {creating&&data?<AddUser options={data} onCancel={()=>setCreating(false)} onCreated={()=>{setCreating(false);setMessage('Account created.');setSearch('');setPage(1);setRefresh(v=>v+1);}}/>:<>
      <div className="directory-toolbar"><Input type="search" aria-label={t('Search users')} placeholder={t('Name, email or Workday ID')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <Button className="blue-button" disabled={!data} onClick={()=>{setMessage('');setCreating(true);}}>{t('Add user')}</Button></div>
      {loading?<p className="empty" role="status">{t('Loading accounts…')}</p>:data&&<>
        <div className="employee-cards">{data.people.map(person=><article className="employee-card" key={person.id}><div><strong>{person.name}</strong><small>{person.email}</small>
          <small>{data.stores.find(s=>s.id===person.store_id)?.name||countryLabel(person.country)||t('All Primark')}</small><small>{t(person.admin_only?'Admin only':'Learner')}</small></div>
          {data.canAssign&&!person.admin_only&&<Button variant="outline" onClick={()=>onAssign(person)}>{t('Assign courses')}</Button>}
        </article>)}</div>
        {!data.people.length&&<p className="empty">{t('No accounts match your search.')}</p>}
        <div className="directory-pagination"><span>{data.total} {t('Users')}</span><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{t('Previous')}</Button><span>{page} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><Button variant="outline" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(v=>v+1)}>{t('Next')}</Button></div>
      </>}
    </>}
  </section></div>;
}

function AddUser({options,onCancel,onCreated}:{options:Options;onCancel:()=>void;onCreated:()=>void}) {
  const {t,country:countryLabel}=useLanguage();
  const [type,setType]=useState('learner'),[role,setRole]=useState(options.roles[0]);
  const countries=[...new Set(options.stores.map(s=>s.country))].sort();
  const [country,setCountry]=useState(options.access.country||''),[storeId,setStoreId]=useState(options.access.siteId||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const needsStore=type==='learner'||role==='site';
  const needsCountry=needsStore||role==='country';
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');
    try{const response=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.get('name'),email:form.get('email'),password:form.get('password'),workdayId:form.get('workdayId'),accountType:type,role,country,storeId})});const result=await response.json();if(!response.ok)throw new Error(result.error);onCreated();}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  return <form className="add-user-form" onSubmit={submit}>
    <h2>{t('Add user')}</h2>{error&&<p className="error" role="alert">{t(error)}</p>}
    <fieldset disabled={busy}>
      <label>{t('Name')}<Input name="name" required minLength={2} maxLength={101} autoComplete="off"/></label>
      <label>{t('Email')}<Input name="email" type="email" required maxLength={254} autoComplete="off"/></label>
      <label>{t('Account type')}<NativeSelect value={type} onChange={e=>setType(e.target.value)}><option value="learner">{t('Learner')}</option><option value="admin">{t('Admin only')}</option></NativeSelect></label>
      {type==='admin'&&<label>{t('Access')}<NativeSelect value={role} onChange={e=>setRole(e.target.value)}>{options.roles.map(value=><option value={value} key={value}>{t(value==='site'?'Store Manager':value==='country'?'Country reporting admin':value==='organisation'?'Primark reporting admin':'Platform admin')}</option>)}</NativeSelect></label>}
      {needsCountry&&<label>{t('Country')}<NativeSelect required value={country} disabled={!!options.access.country} onChange={e=>{setCountry(e.target.value);setStoreId('');}}><option value="">{t('Choose a country')}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></label>}
      {needsStore&&<label>{t('Store')}<NativeSelect required value={storeId} disabled={!!options.access.siteId||!country} onChange={e=>setStoreId(e.target.value)}><option value="">{t('Choose a store')}</option>{options.stores.filter(s=>s.country===country).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>}
      {type==='learner'&&<label>{t('Workday ID')}<Input name="workdayId" maxLength={50} placeholder={t('Optional')}/></label>}
      <label>{t('Password')}<Input name="password" type="password" autoComplete="new-password" required minLength={type==='admin'?16:8} maxLength={128}/></label>
    </fieldset>
    <p className="access-note">{t(type==='admin'?'Admin passwords need 16–128 characters.':'Create a password with 8–128 characters.')}</p>
    {type==='admin'&&<p className="access-explanation">{t('Admin-only accounts use Reporting. Sign in with a personal learner account for training.')}</p>}
    <div className="editor-actions"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('Cancel')}</Button><Button className="blue-button" disabled={busy}>{t(busy?'Saving…':'Create account')}</Button></div>
  </form>;
}
