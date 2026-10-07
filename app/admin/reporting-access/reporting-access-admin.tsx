'use client';
import type {LocalizedText} from '@/lib/ui-copy';
import {useLanguage} from '@/components/language-provider';
import ManageUsers from '@/components/manage-users';
import PageHeader from '@/components/page-header';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {useStores} from '@/components/store-directory';
import type { ReportingAccess } from '@/lib/reporting-types';

type Person = { id: string; name: string; email: string; country: string; store_id: string;
  manager_store_id:string|null; scope: ReportingAccess['scope'] | null; reporting_country: string | null; reporting_site_id: string | null };


function AccessContent() {
 const stores=useStores();
const countries = [...new Set(stores.map(s => s.country))].sort();
const storeName = (id: string | null) => stores.find(s => s.id === id)?.name || id || '';
const scopeLabel = (person: Person) => person.manager_store_id ? `Store Manager · ${storeName(person.manager_store_id)}` : person.scope === 'organisation' ? 'All Primark'
  : person.scope === 'country' ? person.reporting_country : person.scope === 'site'
    ? `${storeName(person.reporting_site_id)} · ${person.reporting_country}` : 'Learner only';
  const {t,country:countryLabel}=useLanguage();

  const [people, setPeople] = useState<Person[]>([]), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const [scope, setScope] = useState<ReportingAccess['scope'] | 'none' | 'manager'>('none');
  const [country, setCountry] = useState(''), [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState<LocalizedText>('');
  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/reporting-access', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load accounts.');
    setPeople(data.people);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  function edit(person: Person) {
    setSelected(person); setScope(person.manager_store_id?'manager':person.scope || 'none');
    setCountry(stores.find(s=>s.id===person.manager_store_id)?.country || person.reporting_country || person.country);
    setSiteId(person.manager_store_id || person.reporting_site_id || person.store_id);
    setError(''); setMessage('');
  }
  async function save() {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/reporting-access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerId: selected.id, scope:scope==='manager'?'site':scope, country, siteId, managerStoreId:scope==='manager'?siteId:null }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not save access.');
      await refresh(); setSelected(null);
      setMessage({key:scope === 'none' ? 'Access removed for {name}.' : 'Access saved for {name}.',values:{name:selected.name}});
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  const shown = people.filter(p => `${p.name} ${p.email} ${storeName(p.store_id)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="access-admin">
      {error && <p className="error" role="alert">{t(error)}</p>}
      {message && <p className="admin-success" role="status">{t(message)}</p>}
      {selected ? <section className="paper access-editor">
        <button className="back" disabled={busy} onClick={() => setSelected(null)}>{t("← Back to accounts")}</button>
        <h2>{selected.name}</h2><p>{selected.email}</p>
        <form onSubmit={e => { e.preventDefault(); void save(); }}>
          <label>{t("Access")}<NativeSelect value={scope} disabled={busy} onChange={e => setScope(e.target.value as typeof scope)}>
            <option value="none">{t("Learner only")}</option><option value="manager">{t("Store Manager")}</option><option value="site">{t("Site reporting admin")}</option>
            <option value="country">{t("Country reporting admin")}</option><option value="organisation">{t("Primark reporting admin")}</option>
          </NativeSelect></label>
          {(scope === 'country' || scope === 'site' || scope === 'manager') && <label>{t("Country")}<NativeSelect required disabled={busy} value={country} onChange={e => { setCountry(e.target.value); setSiteId(''); }}>
            <option value="">{t("Choose a country")}</option>{countries.map(c => <option key={c} value={c}>{countryLabel(c)}</option>)}
          </NativeSelect></label>}
          {(scope === 'site'||scope==='manager') && <label>{t("Site")}<NativeSelect required disabled={busy || !country} value={siteId} onChange={e => setSiteId(e.target.value)}>
            <option value="">{t("Choose a site")}</option>{stores.filter(s => s.country === country).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect></label>}
          <p className="access-explanation">{t(scope === 'manager' ? 'Can see users in the selected store, assign courses from its country library and view store reports.' : scope === 'none' ? 'This account can access its own learning.' : scope === 'organisation'
            ? 'Can view and export reports across all Primark countries and sites.' : scope === 'country'
              ? 'Can view and export reports for the selected country and its sites.' : 'Can view and export reports for the selected site.')}</p>
          {scope !== 'none' && <p className="access-note">{t("They sign in with their email and password. Creating courses and assigning access stay with the platform admin.")}</p>}
          <div className="editor-actions"><Button variant="outline" type="button" disabled={busy} onClick={() => setSelected(null)}>{t("Cancel")}</Button>
            <Button className="blue-button" disabled={busy}>{t(busy ? 'Saving…' : 'Save access')}</Button></div>
        </form>
      </section> : <section className="paper access-people">
        <label className="access-search">{t("Find an account")}<Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Name, email or site")} /></label>
        {loading ? <p className="empty">{t("Loading accounts…")}</p> : !shown.length ? <p className="empty">{t(people.length ? 'No accounts match your search.' : 'Accounts appear here after a learner registers.')}</p> :
          <div className="employee-cards">{shown.map(person => <article className="employee-card" key={person.id}><div><strong>{person.name}</strong><small>{person.email}</small><small>{storeName(person.store_id)} · {countryLabel(person.country)}</small><small>{person.manager_store_id?`${t('Store Manager')} · ${storeName(person.manager_store_id)}`:person.scope==='country'?countryLabel(person.reporting_country||''):person.scope==='site'?`${storeName(person.reporting_site_id)} · ${countryLabel(person.reporting_country||'')}`:t(scopeLabel(person)||'')}</small></div><Button variant="outline" onClick={()=>edit(person)} aria-label={t("Edit access for {name}",{name:person.name})}>{t('Edit access')}</Button></article>)}</div>}
      </section>}
  </div>;
}

export default function ReportingAccessAdmin(){const {t}=useLanguage();return <div className="shell course-admin access-admin app-page"><PageHeader title={t('Manage Users')} view="access"/><main className="main"><ManageUsers access={<AccessContent/>}/></main></div>;}
