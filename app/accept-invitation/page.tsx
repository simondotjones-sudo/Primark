'use client';
import {useEffect,useState,useRef} from 'react';
import {useLanguage,LanguagePicker} from '@/components/language-provider';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
type Invitation={name:string;email:string;store_id:string;store:string;country:string;registered:boolean};
export default function Page(){
 const inspected=useRef(false);
 const {t}=useLanguage(),[invite,setInvite]=useState<Invitation|null>(null),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(inspected.current)return;inspected.current=true;const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';setToken(token);history.replaceState(null,'',location.pathname+location.search);void fetch('/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setInvite(d);}).catch(e=>setError(e.message));},[]);
 async function accept(form:HTMLFormElement){
  if(!invite)return;setBusy(true);setError('');
  try{const data=Object.fromEntries(new FormData(form)),r=await fetch('/api/prototype',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',...data,email:invite.email,storeId:invite.store_id,invitationToken:token})}),d=await r.json();if(!r.ok)throw new Error(d.error);location.assign(d.returnTo||'/?courses=1');}catch(e){setError(e instanceof Error?e.message:'Please try again.');setBusy(false);}
 }
 return <div className="shell"><header className="topbar"><a href="/" className="brand"><strong>PRIMARK</strong></a><LanguagePicker/></header><main className="main" style={{maxWidth:560,margin:'32px auto'}}><section className="paper" style={{padding:28}}><h1>{t('Create your account')}</h1>{error&&<p className="error" role="alert">{t(error)}</p>}{!invite&&!error&&<p>{t('Loading…')}</p>}{invite&&(invite.registered?<><p>{t('This email is already registered. Choose Login to continue.')}</p><a href="/?login=1">{t('Login')}</a></>:<form onSubmit={e=>{e.preventDefault();void accept(e.currentTarget);}} style={{display:'grid',gap:16}}><p>{invite.email}<br/>{invite.store}</p><label>{t('Name')}<Input name="name" required defaultValue={invite.name} minLength={2} maxLength={101}/></label><label>{t('Workday ID')}<Input name="workdayId" required maxLength={50}/></label><label>{t('Password')}<Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required/></label><Button disabled={busy}>{t(busy?'Saving…':'Get Started')}</Button></form>)}</section></main></div>;
}
