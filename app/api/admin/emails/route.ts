import type {NextRequest} from 'next/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {requireUserAdministrator} from '@/lib/user-administration';
import {emailSettings,requireEmailAdmin,saveEmailSettings,createInvitation,changeInvitation} from '@/lib/email-notifications';
import {emailConnection} from '@/lib/email-delivery';
import {renderLearningEmail} from '@/lib/email-templates';
import {emailKinds,type EmailKind} from '@/lib/email-types';
import {db} from '@/lib/database';
import {storeDirectory} from '@/lib/store-directory';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
 const actor=await requireUserAdministrator();requireEmailAdmin(actor);
 const page=Number(request.nextUrl.searchParams.get('page')||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new CourseError('Choose a valid page.');
 const c=emailConnection();
 const [settings,stores,log,invitations,total]=await Promise.all([emailSettings(),storeDirectory(),
  db().prepare(`SELECT o.id,o.kind,o.status,o.created_at,o.sent_at,o.attempts,o.error_code,o.provider_id,COALESCE(o.to_email,l.email,i.email) AS email
   FROM email_outbox o LEFT JOIN learners l ON l.id=o.recipient_id LEFT JOIN learning_invitations i ON i.id=o.invitation_id ORDER BY o.id DESC LIMIT 25 OFFSET ?`).bind((page-1)*25).all(),
  db().prepare(`SELECT i.id,i.name,i.email,i.store_id,i.created_at,i.requested_at,i.first_sent_at,i.accepted_at,i.cancelled_at,
   EXISTS(SELECT 1 FROM learners l WHERE lower(l.email)=lower(i.email)) AS registered
   FROM learning_invitations i ORDER BY i.created_at DESC LIMIT 25 OFFSET ?`).bind((page-1)*25).all(),
  db().prepare('SELECT (SELECT count(*)::int FROM email_outbox) AS logs,(SELECT count(*)::int FROM learning_invitations) AS invitations').first()]);
 return json({settings,stores,connection:{configured:c.configured,ready:c.ready},log:log.results,invitations:invitations.results,total,page,pageSize:25});
}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 const actor=await requireUserAdministrator(request);requireEmailAdmin(actor);
 const b=await bodyJson(request,8000);
 if(b.action==='settings')return json({settings:await saveEmailSettings(actor,b)});
 if(b.action==='invite')return json({id:await createInvitation(actor,b)},201);
 if(['queue','cancel'].includes(b.action)){
  if(typeof b.id!=='string'||b.id.length>100)throw new CourseError('This invitation is no longer available.');
  await changeInvitation(actor,b.id,b.action);return json({ok:true});
 }
 if(b.action==='preview'){
  if(!emailKinds.includes(b.kind)&&b.kind!=='password_reset')throw new CourseError('Choose an email template.');
  const settings=await emailSettings(),days=b.kind==='deadline_reminder'?settings.deadline_days[0]||7:settings.expiry_days[0]||30;
  return json(renderLearningEmail(b.kind as EmailKind|'password_reset',{name:'Sample Learner',title:'Safety Induction',date:new Date(Date.now()+days*86400000).toISOString(),days,hours:settings.invitation_hours,store:'Sample store',overdue:3,expiring:2,assessment:1,path:b.kind==='manager_digest'?'/?view=report':undefined},emailConnection().origin||'https://preview.invalid'));
 }
 throw new CourseError('Choose an email action.');
}catch(e){if((e as {code?:string}).code==='23505')return failed(new CourseError('An invitation already exists for this email.',409));return failed(e);}}
