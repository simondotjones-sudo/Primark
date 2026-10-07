'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function SignIn() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="shell"><header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a></header><main className="main"><div className="paper entry-form" style={{maxWidth:480,margin:'48px auto'}}><h1>Admin sign-in</h1><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { const res = await fetch('/api/admin/session', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password,returnTo:new URLSearchParams(location.search).get('returnTo')}) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); location.assign(data.returnTo); } catch(e) { setError(e instanceof Error ? e.message : 'Please try again.'); setBusy(false); } }}><label>Email address<Input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<Input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<Button className="blue-button" disabled={busy}>{busy?'Signing in…':'Sign in'}</Button></form><p><a href="/">Back to learning</a></p></div></main></div>;
}
