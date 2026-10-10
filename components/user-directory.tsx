'use client';
import {storeLabel} from '@/lib/store-label';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import AdminSummary from '@/components/admin-summary';
import {userRole,userRoleLabels,type UserPerson,type UserOptions,type UserDirectoryData,type UserRole} from '@/lib/user-administration-types';

type Props={type:'all'|'learner'|'admin';onAssign:(person:UserPerson)=>void;onAssignAll:()=>void;onPermissions:(options:UserOptions)=>void};
export default function UserDirectory({type,onAssign,onAssignAll,onPermissions}:Props) {
  const {t,date,country:countryLabel}=useLanguage();
  const [data,setData]=useState<UserDirectoryData|null>(null),[search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [country,setCountry]=useState(''),[storeId,setStoreId]=useState(''),[status,setStatus]=useState('active');
  const [loading,setLoading]=useState(true),[creating,setCreating]=useState(false),[editing,setEditing]=useState<UserPerson|null>(null),[archiving,setArchiving]=useState<UserPerson|null>(null);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [details,setDetails]=useState<UserPerson|null>(null);
  useEffect(()=>{setPage(1);setCreating(false);setEditing(null);setDetails(null);setArchiving(null);},[type]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const timer=setTimeout(()=>{fetch('/api/users?'+new URLSearchParams({search,page:String(page),type,status,country,storeId}),{cache:'no-store',signal:controller.signal}).then(async r=>{
      const result=await r.json();if(!r.ok)throw new Error(result.error);return result;
    }).then(result=>{if(controller.signal.aborted)return;const last=Math.max(1,Math.ceil(result.total/result.pageSize));if(page>last){setPage(last);return;}setData(result);onPermissions(result);setLoading(false);}).catch(e=>{if(e.name!=='AbortError'){setData(null);setError(e.message);setLoading(false);}});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,page,type,status,country,storeId,refresh,onPermissions]);
  function changed(message:string){setCreating(false);setEditing(null);setDetails(null);setArchiving(null);setMessage(message);setRefresh(v=>v+1);}
  async function archive(){
    if(!archiving)return;setBusy(true);setError('');
    try{const response=await fetch('/api/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:archiving.id,revision:archiving.revision,action:archiving.archived_at?'restore':'archive'})});const result=await response.json();if(!response.ok)throw new Error(result.error);changed(archiving.archived_at?'Account restored.':'Account archived.');}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}
    finally{setBusy(false);}
  }
  const countries=[...new Set(data?.stores.map(s=>s.country)||[])].sort();
  return <div className="user-directory">
    {!creating&&!editing&&!details&&data?.platformAdmin&&<AdminSummary items={[{label:t('Users'),value:data.summary.total,blue:true},{label:t('Stores'),value:data.summary.stores},{label:t('Countries'),value:data.summary.countries}]}/>}
    <section className="paper user-panel">
    {error&&!archiving&&<p className="error" role="alert">{t(error)}</p>}
    {message&&<p className="admin-success" role="status">{t(message)}</p>}
    {creating&&data?<AddUser initialType={type==='admin'?'admin':'learner'} options={data} onCancel={()=>setCreating(false)} onCreated={()=>{changed('Account created.');setStatus('active');setSearch('');setPage(1);}}/>:details?<EditDetails key={details.id} person={details} onCancel={()=>{setDetails(null);setRefresh(v=>v+1);}} onSaved={()=>changed('Details saved.')}/>:editing&&data?<EditAccess key={editing.id} person={editing} options={data} onCancel={()=>{setEditing(null);setRefresh(v=>v+1);}} onSaved={()=>changed('Access saved.')}/>:<>
      <div className="directory-toolbar"><Input type="search" aria-label={t('Search users')} placeholder={t('Name, email or Workday ID')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        <div className="directory-actions">{data?.canAssign&&<Button variant="outline" onClick={onAssignAll}>{t('Assign courses')}</Button>}<Button className="blue-button" disabled={!data||loading} onClick={()=>{setMessage('');setCreating(true);}}>{t('Add user')}</Button></div></div>
      <div className="directory-filters">
        {data?.access.scope==='organisation'&&<label>{t('Country')}<NativeSelect value={country} aria-label={t('Filter users by country')} onChange={e=>{setCountry(e.target.value);setStoreId('');setPage(1);}}><option value="">{t('All countries')}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></label>}
        {data?.access.scope!=='site'&&<label>{t('Store')}<NativeSelect value={storeId} aria-label={t('Filter users by store')} onChange={e=>{setStoreId(e.target.value);setPage(1);}}><option value="">{t('All stores')}</option>{data?.stores.filter(s=>!country||s.country===country).map(s=><option key={s.id} value={s.id}>{storeLabel(s)}{!s.active?' · '+t('Archived'):''}</option>)}</NativeSelect></label>}
        <label>{t('Account status')}<NativeSelect value={status} onChange={e=>{setStatus(e.target.value);setPage(1);setMessage('');}}><option value="active">{t('Active')}</option><option value="archived">{t('Archived')}</option></NativeSelect></label>
      </div>
      {loading?<p className="empty" role="status">{t('Loading accounts…')}</p>:data&&<>
        <div className="employee-cards">{data.people.map(person=><article className="employee-card" key={person.id}><div><strong>{person.name}</strong><small>{person.email}</small>
          <small>{t(userRoleLabels[userRole(person)])}{person.archived_at?' · '+t('Archived'):''}</small>
          <small>{data.stores.find(s=>s.id===(person.manager_store_id||person.reporting_site_id||person.store_id))?.name||countryLabel(person.reporting_country||person.country)||t('All Primark')}</small>
          <small className="employee-dates"><span>{t('Created')}: <time dateTime={person.entered_at}>{date(person.entered_at)}</time></span><span>{t('Last login')}: {person.last_login_at?<time dateTime={person.last_login_at}>{date(person.last_login_at)}</time>:t('No login recorded')}</span></small></div>
          <div className="employee-actions">
            {data.canAssign&&!person.admin_only&&!person.archived_at&&<Button variant="outline" onClick={()=>onAssign(person)}>{t('Assign courses')}</Button>}
            {person.canEditDetails&&<Button variant="outline" onClick={()=>{setDetails(person);setMessage('');setError('');}}>{t('Edit details')}</Button>}
            {person.canEdit&&<Button variant="outline" aria-label={t('Edit access for {name}',{name:person.name})} onClick={()=>{setEditing(person);setMessage('');setError('');}}>{t('Edit access')}</Button>}
            {person.canArchive&&<Button variant="outline" aria-label={t(person.archived_at?'Restore {name}':'Archive {name}',{name:person.name})} onClick={()=>{setArchiving(person);setError('');setMessage('');}}>{t(person.archived_at?'Restore':'Archive')}</Button>}
          </div>
        </article>)}</div>
        {!data.people.length&&<p className="empty">{t('No accounts match your search.')}</p>}
        <div className="directory-pagination"><span>{data.total} {t('Users')}</span><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{t('Previous')}</Button><span>{page} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><Button variant="outline" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(v=>v+1)}>{t('Next')}</Button></div>
      </>}
    </>}
    </section>
    <Dialog open={!!archiving} onOpenChange={open=>{if(!open&&!busy){setArchiving(null);setError('');setRefresh(v=>v+1);}}}><DialogContent className="user-action-dialog"><DialogHeader><DialogTitle>{t(archiving?.archived_at?'Restore {name}':'Archive {name}',{name:archiving?.name||''})}</DialogTitle><DialogDescription>{t(archiving?.archived_at?'This account can sign in again with its existing access.':'This account will be signed out and cannot sign in. Training records and certificates will be kept.')}</DialogDescription></DialogHeader>
      {error&&<p className="error" role="alert">{t(error)}</p>}<div className="editor-actions"><Button variant="outline" disabled={busy} onClick={()=>{setArchiving(null);setError('');setRefresh(v=>v+1);}}>{t('Cancel')}</Button><Button className="blue-button" disabled={busy} onClick={()=>void archive()}>{t(busy?'Saving…':archiving?.archived_at?'Restore':'Archive')}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function EditDetails({person,onCancel,onSaved}:{person:UserPerson;onCancel:()=>void;onSaved:()=>void}){
  const {t,lang}=useLanguage();
  const [name,setName]=useState(person.name),[email,setEmail]=useState(person.email);
  const [workdayId,setWorkdayId]=useState(person.workday_id||'');
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const dirty=name!==person.name||email!==person.email||workdayId!==(person.workday_id||'');
  async function act(action:'details'|'password-reset'){
    setBusy(action);setError('');setMessage('');
    try{const response=await fetch('/api/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:person.id,revision:person.revision,action,name,email,workdayId,lang})});const result=await response.json();if(!response.ok)throw new Error(result.error);if(action==='details')onSaved();else setMessage('Password reset email sent.');}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy('');}
  }
  return <form className="add-user-form" onSubmit={event=>{event.preventDefault();void act('details');}}>
    <h2>{t('Edit details')}</h2>{error&&<p className="error" role="alert">{t(error)}</p>}{message&&<p className="admin-success" role="status">{t(message)}</p>}
    <fieldset disabled={!!busy}><label>{t('Name')}<Input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={101}/></label><label>{t('Email')}<Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label><label>{t('Employee ID')}<Input value={workdayId} onChange={e=>setWorkdayId(e.target.value)} maxLength={50} placeholder={t('Optional')}/></label><label>{t('Legacy access code')}<Input value={person.legacy_access_code||''} readOnly aria-readonly="true" placeholder={t('Not recorded')} autoComplete="off"/></label></fieldset>
    <p className="access-note">{t('Changing the email or Employee ID signs the user out. Use the updated details to sign in.')}</p>
    <div className="editor-actions"><Button type="button" variant="outline" disabled={!!busy} onClick={onCancel}>{t('Cancel')}</Button><Button className="blue-button" disabled={!!busy||!dirty}>{t(busy==='details'?'Saving…':'Save details')}</Button></div>
    <div className="user-recovery"><h3>{t('Password')}</h3><p className="access-note">{t('Send a secure reset link to the saved email address. Email delivery must be configured.')}</p>{dirty&&<p className="access-note">{t('Save your changes before sending a reset email.')}</p>}<Button type="button" variant="outline" disabled={!!busy||dirty} onClick={()=>void act('password-reset')}>{t(busy==='password-reset'?'Sending…':'Send password reset email')}</Button></div>
  </form>;
}
function EditAccess({person,options,onCancel,onSaved}:{person:UserPerson;options:UserOptions;onCancel:()=>void;onSaved:()=>void}){
  const {t,country:countryLabel}=useLanguage();
  const [role,setRole]=useState<UserRole>(userRole(person));
  const [country,setCountry]=useState(person.reporting_country||person.country),[storeId,setStoreId]=useState(person.manager_store_id||person.reporting_site_id||person.store_id);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const stores=options.stores.filter(s=>s.active),countries=[...new Set(stores.map(s=>s.country))].sort();
  const needsStore=['learner','site','manager'].includes(role),needsCountry=needsStore||role==='country';
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{const response=await fetch('/api/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:person.id,revision:person.revision,action:'access',role,country,storeId})});const result=await response.json();if(!response.ok)throw new Error(result.error);onSaved();}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  return <form className="add-user-form" onSubmit={save}><h2>{person.name}</h2><p className="access-note">{person.email}</p>{error&&<p className="error" role="alert">{t(error)}</p>}<fieldset disabled={busy}>
    <label>{t('Access')}<NativeSelect value={role} onChange={e=>setRole(e.target.value as UserRole)}>{(['learner','manager',...options.roles] as UserRole[]).map(r=><option key={r} value={r}>{t(userRoleLabels[r])}</option>)}</NativeSelect></label>
    {needsCountry&&<label>{t('Country')}<NativeSelect required value={country} disabled={options.access.scope==='country'} onChange={e=>{setCountry(e.target.value);setStoreId('');}}><option value="">{t('Choose a country')}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></label>}
    {needsStore&&<label>{t('Store')}<NativeSelect required value={storeId} disabled={!country} onChange={e=>setStoreId(e.target.value)}><option value="">{t('Choose a store')}</option>{stores.filter(s=>s.country===country).map(s=><option key={s.id} value={s.id}>{storeLabel(s)}</option>)}</NativeSelect></label>}
  </fieldset><p className="access-explanation">{t(role==='learner'?'This account can access its own learning.':'Admin-only accounts use Reporting. Sign in with a personal learner account for training.')}</p><p className="access-note">{t('The user will need to sign in again after access changes.')}</p><div className="editor-actions"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('Cancel')}</Button><Button className="blue-button" disabled={busy}>{t(busy?'Saving…':'Save access')}</Button></div></form>;
}
function AddUser({options,initialType,onCancel,onCreated}:{options:UserOptions;initialType:string;onCancel:()=>void;onCreated:()=>void}) {
  const {t,country:countryLabel}=useLanguage();
  const [type,setType]=useState(initialType),[role,setRole]=useState(options.roles[0]);
  const countries=[...new Set(options.stores.filter(s=>s.active).map(s=>s.country))].sort();
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
      {needsStore&&<label>{t('Store')}<NativeSelect required value={storeId} disabled={!!options.access.siteId||!country} onChange={e=>setStoreId(e.target.value)}><option value="">{t('Choose a store')}</option>{options.stores.filter(s=>s.active&&s.country===country).map(s=><option key={s.id} value={s.id}>{storeLabel(s)}</option>)}</NativeSelect></label>}
      {type==='learner'&&<label>{t('Workday ID')}<Input name="workdayId" maxLength={50} placeholder={t('Optional')}/></label>}
      <label>{t('Password')}<Input name="password" type="password" autoComplete="new-password" required minLength={type==='admin'?16:8} maxLength={128}/></label>
    </fieldset>
    <p className="access-note">{t(type==='admin'?'Admin passwords need 16–128 characters.':'Create a password with 8–128 characters.')}</p>
    {type==='admin'&&<p className="access-explanation">{t('Admin-only accounts use Reporting. Sign in with a personal learner account for training.')}</p>}
    <div className="editor-actions"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('Cancel')}</Button><Button className="blue-button" disabled={busy}>{t(busy?'Saving…':'Create account')}</Button></div>
  </form>;
}
