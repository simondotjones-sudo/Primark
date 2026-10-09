import type {NextRequest} from 'next/server';
import {db} from '@/lib/database';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {requireUserAdministrator} from '@/lib/user-administration';
import {changeAssignment,creditAccount,creditError} from '@/lib/credits';
import {storeDirectory} from '@/lib/store-directory';
export const dynamic='force-dynamic';
async function scope(request:NextRequest,write=false){
 const actor=await requireUserAdministrator(write?request:undefined),requested=request.nextUrl.searchParams.get('storeId');
 const storeId=actor.platformAdmin?requested:actor.managerStoreId;
 if(!storeId||(!actor.platformAdmin&&requested&&requested!==storeId))throw new CourseError('Store Manager access is required.',403);
 const store=(await storeDirectory()).find(s=>s.id===storeId);if(!store)throw new CourseError('Choose a store.');
 return {actor,store};
}
export async function GET(request:NextRequest){try{
 const {actor,store}=await scope(request),params=request.nextUrl.searchParams;
 const learner=params.get('learnerId')||'',search=(params.get('search')||'').trim().slice(0,150),view=params.get('view')||'current',page=Number(params.get('page')||1);
 if(!['current','removed'].includes(view)||!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Check the search and page number.');
 const {results}=await db().prepare(`SELECT h.id,h.learner_id AS "learnerId",h.learner_name AS "learnerName",h.course_title AS "courseTitle",
 h.assigned_at::text AS "assignedAt",h.started_at::text AS "startedAt",h.completed_at::text AS "completedAt",
 h.cancelled_at::text AS "cancelledAt",h.cancelled_by AS "cancelledBy",h.cancellation_reason AS reason,h.refunded,
 h.previous_id IS NOT NULL AS "hasPrevious",h.billed,
 (h.cancelled_at IS NULL AND a.history_id=h.id AND now()>=h.assigned_at AND now()<h.assigned_at+interval '336 hours'
  AND h.started_at IS NULL AND h.completed_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM scorm_launches s WHERE s.learner_id=h.learner_id AND s.course_id=h.course_id)
  AND NOT EXISTS(SELECT 1 FROM scorm_progress s JOIN course_packages p ON p.id=s.package_id WHERE s.learner_id=h.learner_id AND p.course_id=h.course_id)) AS "canRemove",
 EXISTS(SELECT 1 FROM certificates cert WHERE cert.assignment_id=h.id AND cert.archived_at IS NULL AND cert.expires_at::timestamptz<=now()) AS "canRenew"
 ${actor.platformAdmin?',h.unit_cents AS "unitCents"':''}
 FROM assignment_history h LEFT JOIN course_assignments a ON a.history_id=h.id
 WHERE h.store_id=? AND (?='' OR h.learner_id=?) AND (?='' OR strpos(lower(h.learner_name||' '||h.course_title),lower(?))>0)
 AND ${view==='removed'?'h.cancelled_at IS NOT NULL':'a.history_id IS NOT NULL'}
 ORDER BY h.assigned_at DESC,h.id LIMIT 26 OFFSET ?`).bind(store.id,learner,learner,search,search,(page-1)*25).all();
 return json({rows:results.slice(0,25),hasMore:results.length>25,page,credits:await creditAccount(store.id)});
}catch(e){return failed(creditError(e));}}
export async function POST(request:NextRequest){try{
 const {actor,store}=await scope(request,true),body=await bodyJson(request,5000);
 if(!body||!['remove','renew'].includes(body.action)||typeof body.assignmentId!=='string'||(body.reason!==undefined&&typeof body.reason!=='string'))throw new CourseError('Invalid request.');
 const result=await changeAssignment(actor,store.id,body);
 return json({...(result as object),credits:await creditAccount(store.id)});
}catch(e){return failed(creditError(e));}}
