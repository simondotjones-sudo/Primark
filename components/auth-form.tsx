'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {useStores} from '@/components/store-directory';
import { tr, countryName } from '@/lib/ui-copy';
import type { Language } from '@/lib/i18n';

type Props = {lang:Language; busy:boolean; onAuthenticate:(action:string, fields:Record<string,string>)=>void};
export default function AuthForm({lang,busy,onAuthenticate}:Props) {
 const stores=useStores();
const countries = [...new Set(stores.map(s=>s.country))].sort();
  const t=(text:string)=>tr(lang,text);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[country,setCountry]=useState(''),[storeId,setStoreId]=useState('');
  const [registrationCode,setRegistrationCode]=useState(''),[password,setPassword]=useState('');
  const [loginEmail,setLoginEmail]=useState(''),[loginPassword,setLoginPassword]=useState(''),[oldCode,setOldCode]=useState(''),[legacy,setLegacy]=useState(false);
  const [mode,setMode]=useState('register');
  useEffect(()=>{if(new URLSearchParams(location.search).get('login')==='1')setMode('login');},[]);
  return <div className="paper entry-form"><Tabs value={mode} onValueChange={setMode}>
    <TabsList className="auth-tabs pill-switch" aria-label={t('Account access')}><TabsTrigger value="register">{t('Register')}</TabsTrigger><TabsTrigger value="login">{t('Login')}</TabsTrigger></TabsList>
    <TabsContent value="register"><h2 className="form-heading">{t('Let’s get you started')}</h2>
      <form onSubmit={e=>{e.preventDefault();onAuthenticate('register',{name,email,country,storeId,registrationCode,password});}}>
        <label>{t('Full name')}<Input name="name" autoComplete="name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder={t('Your full name')}/></label>
        <label>{t('Email address')}<Input name="email" autoComplete="email" dir="ltr" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
        <label>{t('Registration code')}<Input name="registrationCode" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" required maxLength={30} value={registrationCode} onChange={e=>setRegistrationCode(e.target.value)}/></label>
        <label>{t('Create password')}<Input name="password" autoComplete="new-password" dir="ltr" type="password" required minLength={8} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} aria-describedby="password-help"/><small id="password-help">{t('At least 8 characters.')}</small></label>
        <label>{t('Country')}<NativeSelect name="country" required value={country} onChange={e=>{setCountry(e.target.value);setStoreId('');}}><option value="">{t('Choose a country')}</option>{countries.map(c=><option key={c} value={c}>{countryName(c,lang)}</option>)}</NativeSelect></label>
        <label>{t('Primark store')}<NativeSelect name="storeId" required disabled={!country} value={storeId} onChange={e=>setStoreId(e.target.value)}><option value="">{t('Choose your store')}</option>{stores.filter(s=>s.country===country).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>
        <Button className="blue-button" size="lg" disabled={busy}>{busy?t('Please wait…'):t('Register')}</Button>
      </form>
    </TabsContent>
    <TabsContent value="login"><h2 className="form-heading">{t(legacy?'Create your password':'Welcome back')}</h2>
      {legacy&&<p>{t('Use your existing pass code once to create a password. Your learning records stay with your account.')}</p>}
      <form onSubmit={e=>{e.preventDefault();onAuthenticate(legacy?'set-password':'login',{email:loginEmail,password:loginPassword,...(legacy?{code:oldCode}:{})});}}>
        <label>{t('Email address')}<Input name="loginEmail" autoComplete="username" dir="ltr" type="email" required maxLength={254} value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}/></label>
        {legacy&&<label>{t('Existing pass code')}<Input name="oldCode" autoComplete="off" dir="ltr" required value={oldCode} onChange={e=>setOldCode(e.target.value)} placeholder="PR-XXXXXXXXXX"/></label>}
        <label>{t(legacy?'Create password':'Password')}<Input name="loginPassword" autoComplete={legacy?'new-password':'current-password'} dir="ltr" type="password" required minLength={legacy?8:undefined} maxLength={legacy?128:1024} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/></label>
        <Button className="blue-button" size="lg" disabled={busy}>{busy?t('Please wait…'):t(legacy?'Save password & login':'Login')}</Button>
        {!legacy&&<a className="auth-help" href={`/forgot-password/?lang=${lang}`}>{t('Forgot password?')}</a>}
        <button type="button" className="auth-help" disabled={busy} onClick={()=>{setLegacy(!legacy);setLoginPassword('');}}>{t(legacy?'Back to Login':'Already have a pass code?')}</button>
      </form>
    </TabsContent>
  </Tabs></div>;
}
