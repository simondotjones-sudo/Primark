import type { NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { currentLearner, db } from '@/lib/server';
import { CourseError } from '@/lib/course-admin';
import stores from '@/lib/stores.json';
import { storeDirectory } from '@/lib/store-directory';
import type { ReportingAccess } from '@/lib/reporting-types';

export async function reportingAccessFor(learnerId: string): Promise<ReportingAccess | null> {
  return db().prepare('SELECT scope,country,site_id AS "siteId" FROM reporting_access WHERE learner_id=?')
    .bind(learnerId).first<ReportingAccess>().then(async access => {
      if (access) return access;
      const manager = await db().prepare('SELECT store_id FROM store_managers WHERE learner_id=?').bind(learnerId).first<{store_id:string}>();
      const store = manager ? (await storeDirectory()).find(s=>s.id===manager.store_id) : null;
      return store ? {scope:'site' as const,country:store.country,siteId:store.id} : null;
    });
}

export async function getReportingAccess(request: NextRequest): Promise<ReportingAccess | null> {
  if (await getAdminUser()) return { scope: 'organisation', country: null, siteId: null };
  const learner = await currentLearner(request);
  return learner ? reportingAccessFor(learner.id) : null;
}

export function reportingFilter(access: ReportingAccess, params: URLSearchParams, directory=stores) {
  const stores=directory;const storeById=new Map(stores.map(s=>[s.id,s]));
  const role = params.get('role') || (access.scope === 'organisation' ? 'global' : access.scope);
  const country = params.get('country') || access.country || '';
  const site = params.get('site') || access.siteId || '';
  if (!['global', 'country', 'site'].includes(role)) throw new CourseError('Choose a reporting view.');
  if (role === 'country' && !stores.some(s => s.country === country)) throw new CourseError('Choose a country.');
  if (role === 'site' && !storeById.has(site)) throw new CourseError('Choose a store.');
  if (access.scope === 'site' && (role !== 'site' || site !== access.siteId))
    throw new CourseError('Reporting is limited to your assigned site.', 403);
  if (access.scope === 'country' && (role === 'global' || (role === 'country' ? country !== access.country : storeById.get(site)?.country !== access.country)))
    throw new CourseError('Reporting is limited to your assigned country.', 403);
  const ids = role === 'global' ? null : role === 'site' ? [site] : stores.filter(s => s.country === country).map(s => s.id);
  return { role, country, site, siteIds: ids };
}
