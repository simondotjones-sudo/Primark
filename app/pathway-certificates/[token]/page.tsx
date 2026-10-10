import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {db} from '@/lib/database';
import {learnerForSession} from '@/lib/server';
import {getUserAdministrator} from '@/lib/user-administration';
import PathwayCertificate from '@/components/pathway-certificate';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{token:string}>}){
 const learner=await learnerForSession((await cookies()).get('primark_session')?.value),admin=await getUserAdministrator();
 if(!learner&&!admin)redirect('/');
 const record=await db().prepare(`SELECT e.name,e.learner_name,e.learner_id,e.completed_at,e.certificate_token,l.store_id,l.country,
 (SELECT jsonb_agg(i.title ORDER BY i.stage,i.position) FROM pathway_enrolment_courses i WHERE i.enrolment_id=e.id) AS courses
 FROM pathway_enrolments e JOIN learners l ON l.id=e.learner_id WHERE e.certificate_token=? AND e.completed_at IS NOT NULL`).bind((await params).token).first<{name:string;learner_name:string;learner_id:string;completed_at:string;certificate_token:string;store_id:string;country:string;courses:string[]}>();
 if(!record)notFound();
 const allowed=record.learner_id===learner?.id||admin?.platformAdmin||admin?.access.scope==='organisation'||admin?.access.scope==='country'&&admin.access.country===record.country||admin?.access.scope==='site'&&admin.access.siteId===record.store_id;
 if(!allowed)notFound();
 return <PathwayCertificate record={record}/>;
}
