import stores from '@/lib/stores.json';
import type {StoreOption} from '@/lib/store-label';
import type { ReportingAccess } from '@/lib/reporting-types';

export type ProfileView = 'learn' | 'report' | 'courses' | 'access' | 'shots' | 'store' | 'organisation' | 'assessor';
export type ProfileAccount = {
  name: string; email: string; role: string; site: string;
  platformAdmin: boolean; reportingAccess: ReportingAccess | null;
  managerStoreId?: string | null;
  adminOnly?: boolean; assessor?:boolean;
};
export type ReportFilter = { role: 'global' | 'country' | 'site'; country: string; site: string };

export function profileViews(account: ProfileAccount): { value: ProfileView; label: string }[] {
  return [
    ...(account.assessor || account.platformAdmin ? [{value:"assessor" as const,label:"Assessor"}] : []),
    ...(!(account.adminOnly || account.platformAdmin || account.reportingAccess || account.managerStoreId) ? [{ value: 'learn' as const, label: 'My Courses' }] : []),
    ...(account.reportingAccess ? [{ value: 'report' as const, label: 'Reporting' }] : []),
    ...(!account.platformAdmin && (account.reportingAccess || account.managerStoreId) ? [{value:'access' as const,label:'Manage Users'}] : []),
    ...(!account.platformAdmin&&['organisation','country'].includes(account.reportingAccess?.scope||'')?[{value:'organisation' as const,label:'Organisation'}]:[]),
    ...(account.platformAdmin ? [
      { value: 'courses' as const, label: 'Courses' },
      { value: 'access' as const, label: 'Manage Users' },
      { value: 'organisation' as const, label: 'Organisation' },
    ] : []),
  ];
}

export function profileScope(access: ReportingAccess, desired: Partial<ReportFilter> = {}, directory:StoreOption[]=stores) {
  const stores=directory;
  const roles: ReportFilter['role'][] = access.scope === 'organisation' ? ['global', 'country', 'site']
    : access.scope === 'country' ? ['country', 'site'] : ['site'];
  const countries = access.scope === 'organisation' ? [...new Set(stores.map(s => s.country))].sort() : [access.country!];
  const country = countries.includes(desired.country || '') ? desired.country! : access.country || (countries.includes('Ireland') ? 'Ireland' : countries[0]);
  const sites = stores.filter(s => s.country === country && (access.scope !== 'site' || s.id === access.siteId));
  const role = desired.role && roles.includes(desired.role) ? desired.role : roles[0];
  const site = sites.some(s => s.id === desired.site) ? desired.site! : access.siteId || sites[0]?.id || '';
  return { roles, countries, sites, filter: { role, country, site } };
}

export function profileHref(view: ProfileView, filter?: ReportFilter) {
  if (view === 'assessor') return '/assessor';
  if (view === 'organisation') return '/admin/organisation';
  if (view === 'store') return '/store';
  if (view === 'courses') return '/admin/courses';
  if (view === 'access') return '/admin/reporting-access';
  if (view === 'shots') return '/shot-list';
  return view === 'report' ? '/?' + new URLSearchParams({ view: 'report', ...filter }) : '/?courses=1';
}
