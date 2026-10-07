import type { NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { bodyJson, CourseError, failed, json, requireAdmin } from '@/lib/course-admin';
import { db, now, storeById } from '@/lib/server';
import stores from '@/lib/stores.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const people = await db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,
      r.scope,r.country AS reporting_country,r.site_id AS reporting_site_id,r.updated_at
      FROM learners l LEFT JOIN reporting_access r ON r.learner_id=l.id ORDER BY l.name,l.email`).all();
    return json({ people: people.results });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = await getAdminUser();
    const body = await bodyJson(request, 10000);
    if (typeof body.learnerId !== 'string' || !await db().prepare('SELECT id FROM learners WHERE id=?').bind(body.learnerId).first())
      throw new CourseError('Choose an existing learner account.');
    if (body.scope === 'none') {
      await db().prepare('DELETE FROM reporting_access WHERE learner_id=?').bind(body.learnerId).run();
      return json({ ok: true });
    }
    if (!['organisation', 'country', 'site'].includes(body.scope)) throw new CourseError('Choose a reporting scope.');
    let country: string | null = null, siteId: string | null = null;
    if (body.scope === 'country') {
      if (typeof body.country !== 'string' || !stores.some(s => s.country === body.country)) throw new CourseError('Choose a country from the directory.');
      country = body.country;
    }
    if (body.scope === 'site') {
      const site = typeof body.siteId === 'string' ? storeById.get(body.siteId) : null;
      if (!site) throw new CourseError('Choose a site from the directory.');
      siteId = site.id; country = site.country;
    }
    await db().prepare(`INSERT INTO reporting_access(learner_id,scope,country,site_id,assigned_by,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(learner_id) DO UPDATE SET scope=excluded.scope,country=excluded.country,
      site_id=excluded.site_id,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`)
      .bind(body.learnerId,body.scope,country,siteId,admin!.email,now()).run();
    return json({ ok: true });
  } catch (error) { return failed(error); }
}
