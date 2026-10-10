import type {NextRequest} from 'next/server';
import {requireUserAdministrator} from '@/lib/user-administration';
import {db} from '@/lib/database';
import {failed,json,CourseError} from '@/lib/course-admin';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
 const actor=await requireUserAdministrator();
 // Whole-organisation audit contains historic cross-store and privileged changes.
 if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);
 const p=request.nextUrl.searchParams,search=(p.get('search')||'').trim().slice(0,150),entity=p.get('entity')||'',page=Number(p.get('page')||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Choose a valid page.');
 const from=p.get('from')||'',to=p.get('to')||'';
 for(const day of [from,to])if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day))throw new CourseError('Choose a valid date.');
 const where=`WHERE (?='' OR entity=?) AND (?='' OR strpos(lower(actor||' '||entity_id||' '||COALESCE(reason,'')||' '||COALESCE(previous_state::text,'')||' '||COALESCE(next_state::text,'')),lower(?))>0)
 AND (NULLIF(?,'')::date IS NULL OR recorded_at>=NULLIF(?,'')::date) AND (NULLIF(?,'')::date IS NULL OR recorded_at<(NULLIF(?,'')::date+1))`;
 const args=[entity,entity,search,search,from,from,to,to];
 const [rows,count]=await Promise.all([db().prepare(`SELECT * FROM audit_events ${where} ORDER BY recorded_at DESC,id DESC LIMIT 25 OFFSET ?`).bind(...args,(page-1)*25).all(),db().prepare(`SELECT count(*)::int total FROM audit_events ${where}`).bind(...args).first<{total:number}>()]);
 return json({events:rows.results,total:count?.total||0,page,pageSize:25});
}catch(e){return failed(e);}}
