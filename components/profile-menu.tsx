'use client';
import {useLanguage} from '@/components/language-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, MapPin, UserRound } from 'lucide-react';
import { APP_VERSION } from '@/lib/app-version';
import { profileHref, profileScope, profileViews, type ProfileAccount, type ProfileView, type ReportFilter } from '@/lib/profile';

type ContentProps = {
  account: ProfileAccount;
  view: ProfileView;
  filter?: ReportFilter;
  onView: (view: ProfileView) => void;
  onFilter: (filter: ReportFilter) => void;
  onSignOut: () => void;
  busy?: boolean;
};

export function ProfileContent({ account, view, filter, onView, onFilter, onSignOut, busy }: ContentProps) {
  const {t,country:countryLabel}=useLanguage();

  const scope = account.reportingAccess ? profileScope(account.reportingAccess, filter) : null;
  const changeFilter = (change: Partial<ReportFilter>) => {
    if (account.reportingAccess && scope) onFilter(profileScope(account.reportingAccess, { ...scope.filter, ...change }).filter);
  };
  const views = profileViews(account);
  return <>
    <div className="profile-identity"><strong>{account.name}</strong>{account.name !== account.email && <small>{account.email}</small>}
      <span className="profile-role">{t(account.role)}</span><span className="profile-site"><MapPin size={15}/>{account.platformAdmin?t('All Primark'):account.site}</span></div>
    {views.length > 1 && <label className="profile-field">{t("View")}<select value={view} onChange={e => onView(e.target.value as ProfileView)}>
      {views.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
    </select></label>}
    {scope && view === 'report' && <div className="profile-scope">
      <label className="profile-field">{t("Reporting level")}<select value={scope.filter.role} disabled={scope.roles.length === 1} onChange={e => changeFilter({ role: e.target.value as ReportFilter['role'] })}>
        {scope.roles.map(role => <option key={role} value={role}>{t(role === 'global' ? 'All Primark' : role === 'country' ? 'Country' : 'Site')}</option>)}
      </select></label>
      {scope.filter.role !== 'global' && <label className="profile-field">{t("Country")}<select value={scope.filter.country} disabled={scope.countries.length === 1} onChange={e => changeFilter({ country: e.target.value, site: '' })}>
        {scope.countries.map(country => <option key={country} value={country}>{countryLabel(country)}</option>)}
      </select></label>}
      {scope.filter.role === 'site' && <label className="profile-field">{t("Site")}<select value={scope.filter.site} disabled={scope.sites.length === 1} onChange={e => changeFilter({ site: e.target.value })}>
        {scope.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select></label>}
    </div>}
    <button type="button" className="profile-signout" disabled={busy} onClick={onSignOut}><LogOut size={17}/>{t(busy ? 'Signing out…' : 'Sign out')}</button>
    <div className="profile-version">{t("Primark Version")}{" "}<bdi>{APP_VERSION}</bdi></div>
  </>;
}

type Props = {
  account?: ProfileAccount | null;
  view?: ProfileView;
  filter?: ReportFilter;
  onViewChange?: (view: ProfileView) => void;
  onFilterChange?: (filter: ReportFilter) => void;
  onSignOut?: () => void | Promise<void>;
  onOpen?: () => void;
};

export default function ProfileMenu({ account: supplied, view = 'learn', filter, onViewChange, onFilterChange, onSignOut, onOpen }: Props) {
  const {t}=useLanguage();

  const [loaded, setLoaded] = useState<ProfileAccount | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const account = supplied === undefined ? loaded : supplied;
  const refresh = useCallback(async () => {
    if (supplied !== undefined) return;
    try { const res = await fetch('/api/prototype?view=me', { cache: 'no-store' }); const data = await res.json(); setLoaded(res.ok ? data.account : null); }
    catch { setLoaded(null); }
  }, [supplied]);
  useEffect(() => { void refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [refresh]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (details.current && !details.current.contains(event.target as Node)) details.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && details.current?.open) { details.current.open = false; details.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  if (!account) return null;
  const effectiveFilter = account.reportingAccess ? profileScope(account.reportingAccess, filter).filter : undefined;
  async function signOut() {
    setBusy(true); setError('');
    try {
      if (onSignOut) await onSignOut();
      else {
        const res = await fetch(account!.platformAdmin ? '/api/admin/session' : '/api/prototype', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
        if (!res.ok) throw new Error('Could not sign out. Please try again.');
        location.assign('/');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <details className="profile-menu" ref={details} onToggle={event => { if (event.currentTarget.open) { onOpen?.(); void refresh(); } }}>
    <summary className="profile-trigger" aria-label={t("Open profile")} title={t("Your profile")}><UserRound size={22}/></summary>
    <div className="profile-panel" role="region" aria-label={t("Your profile")}>
      <ProfileContent account={account} view={view} filter={effectiveFilter} busy={busy}
        onView={next => { if (onViewChange) onViewChange(next); else location.assign(profileHref(next, effectiveFilter)); }}
        onFilter={next => { if (onFilterChange) onFilterChange(next); else location.assign(profileHref('report', next)); }} onSignOut={() => void signOut()}/>
      {error && <p className="profile-error" role="alert">{t(error)}</p>}
    </div>
  </details>;
}
