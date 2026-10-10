import { activeLearnerSql } from '@/lib/account-type';
import { NextRequest } from 'next/server';
import { getAdminUser } from '@/lib/admin-auth';
import { db, now } from '@/lib/server';
import { sameOrigin } from '@/lib/shot-server';
import { type Audience, type Course, type Package } from '@/lib/course-types';
import {storeDirectory} from '@/lib/store-directory';
export async function isPlatformAdmin() { return !!await getAdminUser(); }
export class CourseError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function requireAdmin(request?: NextRequest) { if (!await isPlatformAdmin()) throw new CourseError('Platform admin sign-in is required.', 403); if (request && !sameOrigin(request)) throw new CourseError('Please make this change from the course page.',403); }
export function json(data: unknown, status = 200) { return Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}}); }
export function failed(error: unknown) { if (error instanceof CourseError) return json({error:error.message},error.status); console.error('Course operation failed',error); return json({error:'This change could not be completed. Please try again.'},503); }
export async function bodyJson(request: Request, limit = 1000000) { if (!request.body) throw new CourseError('A request body is required.'); const reader=request.body.getReader(); const decoder=new TextDecoder(); let text='',size=0; while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();throw new CourseError('This request is too large.',413);}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();try { return JSON.parse(text); } catch { throw new CourseError('Invalid request.'); } }
export async function getCourse(id: string) { return db().prepare(`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('country',r.country,'courseId',r.refresher_course_id) ORDER BY r.country) FROM course_refresher_rules r WHERE r.source_course_id=c.id),'[]'::jsonb) AS refresher_rules FROM courses c WHERE c.id=?`).bind(id).first<Course>(); }
export async function getPackage(id: string) { return db().prepare('SELECT * FROM course_packages WHERE id=?').bind(id).first<Package>(); }
export async function validateAudience(input: unknown): Promise<Audience> {
  if (!input || typeof input !== 'object') throw new CourseError('Choose a course audience.');
  const stores=await storeDirectory(false);
  const value = input as Audience;
  for (const field of ['countries','sites','users'] as const) if (!Array.isArray(value[field]) || value[field].length > 10000 || value[field].some(v=>typeof v !== 'string')) throw new CourseError('Invalid audience.');
  const a: Audience = {countries:[...new Set(value.countries)],sites:[...new Set(value.sites)],users:[...new Set(value.users)]};
  if (a.countries.some(c=>!stores.some(s=>s.country===c)) || a.sites.some(id=>!stores.some(s=>s.id===id))) throw new CourseError('Choose countries and sites from the directory.');
  const users = await db().prepare(`SELECT l.id FROM learners l WHERE ${activeLearnerSql()}`).all<{id:string}>();
  const ids = new Set(users.results.map(p=>p.id));
  if (a.users.some(id=>!ids.has(id))) throw new CourseError('One of the selected users is no longer available.');
  return a;
}
export { now };
