import { NextRequest } from 'next/server';
import { db } from '@/lib/server';
import { bodyJson, failed, getCourse, getPackage, json, now, requireAdmin, validateAudience, CourseError } from '@/lib/course-admin';
import { type Course, type Person } from '@/lib/course-types';
export const dynamic='force-dynamic';
export async function GET() { try {
  await requireAdmin();
  const [courses,people,packages,progress] = await Promise.all([
    db().prepare('SELECT * FROM courses ORDER BY updated_at DESC').all<Course>(),
    db().prepare('SELECT id,name,email,country,store_id FROM learners ORDER BY name').all<Person>(),
    db().prepare("SELECT * FROM course_packages WHERE status='ready'").all<any>(),
    db().prepare('SELECT learner_id,package_id,sco_id,status,score,updated_at FROM scorm_progress').all<any>(),
  ]);
  return json({courses:courses.results,people:people.results,packages:packages.results,progress:progress.results});
} catch(e) { return failed(e); } }
export async function POST(request: NextRequest) { try {
  await requireAdmin(request);
  const b=await bodyJson(request); const title=typeof b.title==='string'?b.title.trim():''; const description=typeof b.description==='string'?b.description.trim():'';
  if (!title || title.length>150 || description.length>2000) throw new CourseError('Add a course title (up to 150 characters) and a description of up to 2,000 characters.');
  if (!['draft','published'].includes(b.status)) throw new CourseError('Invalid course status.');
  const audience=await validateAudience(b.audience);
  const existing=b.id?await getCourse(b.id):null;
  if (b.id && !existing) throw new CourseError('Course not found.',404);
  if (b.status==='published') {
    if (!existing?.package_id || (await getPackage(existing.package_id))?.status!=='ready') throw new CourseError('Upload and validate a SCORM package before publishing.');
    if (!audience.countries.length&&!audience.sites.length&&!audience.users.length) throw new CourseError('Choose at least one country, site or user before publishing.');
  }
  const id=existing?.id||crypto.randomUUID(); const date=now();
  if (existing) {
    const result=await db().prepare('UPDATE courses SET title=?,description=?,audience_json=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
      .bind(title,description,JSON.stringify(audience),b.status,date,id,b.revision).run();
    if (!result.meta.changes) throw new CourseError('This course changed in another session. Reload it before saving.',409);
  } else await db().prepare('INSERT INTO courses(id,title,description,status,audience_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,title,description,b.status,JSON.stringify(audience),date,date).run();
  return json({course:await getCourse(id)});
} catch(e) { return failed(e); } }
