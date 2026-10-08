'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useStores } from '@/components/store-directory';
import { tr, countryName } from '@/lib/ui-copy';
import type { Language } from '@/lib/i18n';

type Props = {lang:Language; busy:boolean; error:string; onClearError:()=>void; onAuthenticate:(action:string, fields:Record<string,string>)=>void};
export default function AuthForm({lang,busy,error,onClearError,onAuthenticate}:Props) {
  const stores=useStores();
  const t=(text:string)=>tr(lang,text);
  const [firstName,setFirstName]=useState(''),[surname,setSurname]=useState(''),[email,setEmail]=useState(''),[workdayId,setWorkdayId]=useState(''),[storeId,setStoreId]=useState('');
  const [registrationCode,setRegistrationCode]=useState(''),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false);
  const [loginId,setLoginId]=useState(''),[loginPassword,setLoginPassword]=useState(''),[showLoginPassword,setShowLoginPassword]=useState(false),[oldCode,setOldCode]=useState(''),[legacy,setLegacy]=useState(false);
  const [mode,setMode]=useState('register'),[step,setStep]=useState(1),[formError,setFormError]=useState(''),[storeSearch,setStoreSearch]=useState('');
  const detailsHeading=useRef<HTMLHeadingElement>(null);
  const storeItems=useMemo(()=>stores.map(s=>({value:s.id,label:`${s.name} · ${countryName(s.country,lang)}`})),[stores,lang]);
  const selectedStore=stores.find(s=>s.id===storeId);
  const details=mode==='register'&&step===2;
  useEffect(()=>{if(new URLSearchParams(location.search).get('login')==='1')setMode('login');},[]);
  useEffect(()=>{if(details)detailsHeading.current?.focus({preventScroll:true});},[details]);
  useEffect(()=>{if(selectedStore)setStoreSearch(`${selectedStore.name} · ${countryName(selectedStore.country,lang)}`);},[lang,selectedStore?.id,selectedStore?.name,selectedStore?.country]);
  const clearError=()=>{setFormError('');onClearError();};
  const changeMode=(value:string)=>{clearError();setMode(value);};
  const notice=formError||error;
  const errorNotice=notice?<div id="auth-error" className="auth-error" role="alert">{t(notice)}</div>:null;
  return <div className={'paper entry-form compact-auth'+(details?' auth-details':'')}><Tabs value={mode} onValueChange={changeMode}>
    {!details&&<TabsList className="auth-tabs pill-switch" aria-label={t('Account access')}><TabsTrigger value="register" disabled={busy}>{t('Register')}</TabsTrigger><TabsTrigger value="login" disabled={busy}>{t('Login')}</TabsTrigger></TabsList>}
    <TabsContent value="register" aria-labelledby="registration-heading">
      {step===1?<div className="auth-step" key="code">
        <div className="auth-intro"><span className="auth-step-label">{t('Step 1 of 2')}</span><h2 id="registration-heading" className="form-heading">{t('Let’s get you started')}</h2><p>{t('Enter the induction code from your manager.')}</p></div>
        <form onSubmit={e=>{e.preventDefault();clearError();if(registrationCode.trim().toLowerCase()!=='safety'){setFormError('Check your induction code and try again.');return;}setRegistrationCode(registrationCode.trim());setStep(2);}}>
          <label htmlFor="induction-code">{t('Induction code')}<Input id="induction-code" name="registrationCode" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" required maxLength={30} value={registrationCode} onChange={e=>{setRegistrationCode(e.target.value);clearError();}} aria-invalid={!!notice} aria-describedby={notice?'auth-error':undefined}/></label>
          {errorNotice}
          <Button className="blue-button auth-submit" size="lg" disabled={busy}>{t('Continue')}<ArrowRight size={17}/></Button>
        </form>
        <button className="auth-help auth-switch" type="button" onClick={()=>changeMode('login')}>{t('Already registered? Log in')}</button>
      </div>:<div className="auth-step" key="details">
        <div className="auth-details-heading"><button type="button" className="auth-back" disabled={busy} aria-label={t('Back to induction code')} onClick={()=>{clearError();setStep(1);}}><ArrowLeft size={19}/></button><h2 id="registration-heading" ref={detailsHeading} tabIndex={-1} className="form-heading">{t('Create account')}</h2><span className="auth-step-label" aria-label={t('Step 2 of 2')}>2 / 2</span></div>
        <form onSubmit={e=>{e.preventDefault();clearError();if(!selectedStore){setFormError('Choose your store from the list.');return;}onAuthenticate('register',{firstName,surname,email,workdayId,country:selectedStore.country,storeId,registrationCode,password});}}>
          <div className="auth-name-row">
            <label htmlFor="first-name">{t('First name')}<Input id="first-name" name="given-name" autoComplete="given-name" required maxLength={50} value={firstName} onChange={e=>setFirstName(e.target.value)} disabled={busy}/></label>
            <label htmlFor="surname">{t('Surname')}<Input id="surname" name="family-name" autoComplete="family-name" required maxLength={50} value={surname} onChange={e=>setSurname(e.target.value)} disabled={busy}/></label>
          </div>
          <label htmlFor="registration-email">{t('Email address')}<Input id="registration-email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
          <label htmlFor="workday-id"><span>{t('Workday ID')} <small>{t('(optional)')}</small></span><Input id="workday-id" name="workdayId" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" maxLength={50} value={workdayId} onChange={e=>setWorkdayId(e.target.value)} disabled={busy}/></label>
          <div className="auth-store-field">
            <label htmlFor="registration-store">{t('Primark store')}</label>
            <Combobox.Root items={storeItems} value={storeItems.find(s=>s.value===storeId)||null} inputValue={storeSearch} onInputValueChange={(value,details)=>{setStoreSearch(value);if(details.reason==='input-change')setStoreId('');}} onValueChange={item=>{setStoreId(item?.value||'');clearError();}} isItemEqualToValue={(a,b)=>a.value===b.value} name="storeId" disabled={busy} autoHighlight>
              <div className="auth-store-input"><Combobox.Input id="registration-store" placeholder={t('Search for your store')} autoComplete="off" aria-required="true"/><Combobox.Trigger aria-label={t('Choose your store')}><ChevronDown size={18}/></Combobox.Trigger></div>
              <Combobox.Portal><Combobox.Positioner sideOffset={6} className="auth-store-positioner"><Combobox.Popup className="auth-store-popup" dir={lang==='ar'?'rtl':'ltr'}><Combobox.Empty className="auth-store-empty">{t('No stores found.')}</Combobox.Empty><Combobox.List>{item=><Combobox.Item key={item.value} value={item} className="auth-store-option"><span>{item.label}</span><Combobox.ItemIndicator><Check size={17}/></Combobox.ItemIndicator></Combobox.Item>}</Combobox.List></Combobox.Popup></Combobox.Positioner></Combobox.Portal>
            </Combobox.Root>
          </div>
          <div className="auth-password-field"><label htmlFor="registration-password">{t('Password')}</label><div className="auth-password"><Input id="registration-password" name="password" autoComplete="new-password" dir="ltr" type={showPassword?'text':'password'} required minLength={8} maxLength={128} placeholder={t('At least 8 characters.')} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/><button type="button" aria-label={t(showPassword?'Hide password':'Show password')} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></div>
          {errorNotice}
          <Button className="blue-button auth-submit" size="lg" disabled={busy}>{busy?t('Please wait…'):t('Create account')}<ArrowRight size={17}/></Button>
        </form>
      </div>}
    </TabsContent>
    <TabsContent value="login"><div className="auth-step">
      <div className="auth-intro"><h2 className="form-heading">{t(legacy?'Create your password':'Welcome back')}</h2>{legacy&&<p>{t('Use your existing pass code once to create a password. Your learning records stay with your account.')}</p>}</div>
      <form onSubmit={e=>{e.preventDefault();clearError();onAuthenticate(legacy?'set-password':'login',{...(legacy?{email:loginId,code:oldCode}:{identifier:loginId}),password:loginPassword});}}>
        <label htmlFor="login-id">{t(legacy?'Email address':'Email or Workday ID')}<Input id="login-id" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" type={legacy?'email':'text'} required maxLength={254} value={loginId} onChange={e=>setLoginId(e.target.value)} disabled={busy}/></label>
        {legacy&&<label htmlFor="old-code">{t('Existing pass code')}<Input id="old-code" name="oldCode" autoComplete="off" dir="ltr" required value={oldCode} onChange={e=>setOldCode(e.target.value)} placeholder="PR-XXXXXXXXXX" disabled={busy}/></label>}
        <div className="auth-password-field"><label htmlFor="login-password">{t(legacy?'Create password':'Password')}</label><div className="auth-password"><Input id="login-password" name="password" autoComplete={legacy?'new-password':'current-password'} dir="ltr" type={showLoginPassword?'text':'password'} required minLength={legacy?8:undefined} maxLength={legacy?128:1024} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} disabled={busy}/><button type="button" aria-label={t(showLoginPassword?'Hide password':'Show password')} aria-pressed={showLoginPassword} onClick={()=>setShowLoginPassword(!showLoginPassword)}>{showLoginPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></div>
        {errorNotice}
        <Button className="blue-button auth-submit" size="lg" disabled={busy}>{busy?t('Please wait…'):t(legacy?'Save password & login':'Login')}</Button>
      </form>
      <div className="auth-login-help">{!legacy&&<a className="auth-help" href={`/forgot-password/?lang=${lang}`}>{t('Forgot password?')}</a>}<button type="button" className="auth-help auth-legacy-help" disabled={busy} onClick={()=>{clearError();setLegacy(!legacy);setLoginPassword('');}}>{t(legacy?'Back to Login':'Already have a pass code?')}</button></div>
    </div></TabsContent>
  </Tabs></div>;
}
