'use client';
import ProfileMenu from '@/components/profile-menu';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import stores from '@/lib/stores.json';
import type { ReportingAccess } from '@/lib/reporting-types';

type Person = { id: string; name: string; email: string; country: string; store_id: string;
  scope: ReportingAccess['scope'] | null; reporting_country: string | null; reporting_site_id: string | null };
const countries = [...new Set(stores.map(s => s.country))].sort();
const storeName = (id: string | null) => stores.find(s => s.id === id)?.name || id || '';
const scopeLabel = (person: Person) => person.scope === 'organisation' ? 'All Primark'
  : person.scope === 'country' ? person.reporting_country : person.scope === 'site'
    ? `${storeName(person.reporting_site_id)} · ${person.reporting_country}` : 'Learner only';

export default function ReportingAccessAdmin() {
  const [people, setPeople] = useState<Person[]>([]), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const [scope, setScope] = useState<ReportingAccess['scope'] | 'none'>('none');
  const [country, setCountry] = useState(''), [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/reporting-access', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load accounts.');
    setPeople(data.people);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  function edit(person: Person) {
    setSelected(person); setScope(person.scope || 'none');
    setCountry(person.reporting_country || person.country);
    setSiteId(person.reporting_site_id || person.store_id);
    setError(''); setMessage('');
  }
  async function save() {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/reporting-access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerId: selected.id, scope, country, siteId }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not save access.');
      await refresh(); setSelected(null);
      setMessage(scope === 'none' ? `Reporting access removed for ${selected.name}.` : `Reporting access saved for ${selected.name}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  const shown = people.filter(p => `${p.name} ${p.email} ${storeName(p.store_id)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="shell course-admin access-admin">
    <header className="topbar"><a href="/" className="brand"><strong>PRIMARK</strong></a><ProfileMenu view="access"/></header>
    <main className="main">
      <div className="admin-heading"><div><span className="eyebrow">PLATFORM ADMIN</span><h1>Reporting access</h1>
        <p>Choose an account and the reports it can see.</p></div></div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {selected ? <section className="paper access-editor">
        <button className="back" disabled={busy} onClick={() => setSelected(null)}>← Back to accounts</button>
        <h2>{selected.name}</h2><p>{selected.email}</p>
        <form onSubmit={e => { e.preventDefault(); void save(); }}>
          <label>Access<NativeSelect value={scope} disabled={busy} onChange={e => setScope(e.target.value as typeof scope)}>
            <option value="none">Learner only</option><option value="site">Site reporting admin</option>
            <option value="country">Country reporting admin</option><option value="organisation">Primark reporting admin</option>
          </NativeSelect></label>
          {(scope === 'country' || scope === 'site') && <label>Country<NativeSelect required disabled={busy} value={country} onChange={e => { setCountry(e.target.value); setSiteId(''); }}>
            <option value="">Choose a country</option>{countries.map(c => <option key={c}>{c}</option>)}
          </NativeSelect></label>}
          {scope === 'site' && <label>Site<NativeSelect required disabled={busy || !country} value={siteId} onChange={e => setSiteId(e.target.value)}>
            <option value="">Choose a site</option>{stores.filter(s => s.country === country).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect></label>}
          <p className="access-explanation">{scope === 'none' ? 'This account can access its own learning.' : scope === 'organisation'
            ? 'Can view and export reports across all Primark countries and sites.' : scope === 'country'
              ? 'Can view and export reports for the selected country and its sites.' : 'Can view and export reports for the selected site.'}</p>
          {scope !== 'none' && <p className="access-note">They sign in with their existing learner email and pass code. Course management and assigning access stay with the platform admin.</p>}
          <div className="editor-actions"><Button variant="outline" type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
            <Button className="blue-button" disabled={busy}>{busy ? 'Saving…' : 'Save access'}</Button></div>
        </form>
      </section> : <section className="paper access-people">
        <label className="access-search">Find an account<Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, email or site" /></label>
        {loading ? <p className="empty">Loading accounts…</p> : !shown.length ? <p className="empty">{people.length ? 'No accounts match your search.' : 'Accounts appear here after a learner registers.'}</p> :
          <div className="table-scroll"><table><thead><tr><th>Account</th><th>Home site</th><th>Reporting access</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{shown.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.email}</small></td>
              <td>{storeName(person.store_id)}<small>{person.country}</small></td>
              <td><span className={person.scope ? 'access-badge' : 'access-none'}>{scopeLabel(person)}</span></td>
              <td><Button variant="outline" onClick={() => edit(person)} aria-label={`Edit access for ${person.name}`}>Edit access</Button></td></tr>)}</tbody></table></div>}
      </section>}
    </main>
  </div>;
}
