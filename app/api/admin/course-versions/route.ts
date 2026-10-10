import type {NextRequest} from 'next/server';
import {db} from '@/lib/database';
import {requireAdmin,failed,json} from '@/lib/course-admin';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{await requireAdmin();return json({versions:(await db().prepare(`SELECT v.version,v.published_at,v.published_by,v.reason,v.retraining,v.snapshot->>'title' AS title,v.snapshot->>'package_id' AS package_id,
 (SELECT count(*)::int FROM assignment_history h JOIN course_assignments a ON a.history_id=h.id WHERE h.course_id=v.course_id AND h.learning_version=v.version) AS learners FROM course_versions v WHERE v.course_id=? ORDER BY version DESC`).bind(request.nextUrl.searchParams.get('id')).all()).results});}catch(e){return failed(e);}}
