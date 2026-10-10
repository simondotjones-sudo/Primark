'use client';
import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useLanguage} from '@/components/language-provider';

export default function CompleteEmail({busy,error,onSave,onCancel}:{busy:boolean;error:string;onSave:(email:string)=>void;onCancel:()=>void}) {
  const {t}=useLanguage();
  const [email,setEmail]=useState('');
  return <div className="entry email-completion"><section className="paper entry-form compact-auth" aria-labelledby="email-heading">
    <div className="auth-intro"><h2 id="email-heading" className="form-heading">{t('Add your email address')}</h2><p>{t('To continue, enter an email address that is not already linked to another account.')}</p></div>
    <form onSubmit={event=>{event.preventDefault();onSave(email);}}>
      <div className="auth-floating-field"><Input id="account-email" type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" required maxLength={254} placeholder=" " value={email} onChange={event=>setEmail(event.target.value)} disabled={busy} aria-describedby={error?'email-error':undefined}/><label htmlFor="account-email">{t('Email address')}</label></div>
      {error&&<div id="email-error" className="auth-error" role="alert">{t(error)}</div>}
      <Button className="blue-button auth-submit" size="lg" disabled={busy}>{t(busy?'Please wait…':'Save and continue')}<ArrowRight size={17}/></Button>
    </form>
    <button className="auth-help auth-switch" type="button" disabled={busy} onClick={onCancel}>{t('Back to Login')}</button>
  </section></div>;
}
