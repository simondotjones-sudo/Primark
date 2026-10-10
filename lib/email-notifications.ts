import {requireFeature} from '@/lib/features';
import {createHash} from 'node:crypto';
import {db,inTransaction} from '@/lib/database';
import {emailKinds,type EmailSettings} from '@/lib/email-types';
import {emailConnection} from '@/lib/email-delivery';
import {CourseError} from '@/lib/course-admin';
import type {UserAdministrator} from '@/lib/user-administration';
import {storeDirectory} from '@/lib/store-directory';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
type Client=Parameters<Parameters<typeof inTransaction>[0]>[0];
export async function emailSettings(){return (await db().prepare('SELECT mode,revision,active_since,enabled,expiry_days,deadline_days,invitation_hours FROM email_settings WHERE id=1').first<EmailSettings>())!;}
async function audit(client:Client,actor:string,action:string,details:Record<string,unknown>){
 await client.query('INSERT INTO email_audit(actor,action,details) VALUES($1,$2,$3)',[actor,action,JSON.stringify(details)]);
 await client.query("INSERT INTO audit_events(actor,entity,entity_id,action,next_state) VALUES($1,'email',$2,$3,$4)",[actor,String(details.id||'settings'),action,JSON.stringify(details)]);
}
export function requireEmailAdmin(actor:UserAdministrator){if(!actor.platformAdmin&&actor.access.scope!=='organisation')throw new CourseError('Organisation admin access is required.',403);}
async function recheckActor(client:Client,actor:UserAdministrator){
 requireEmailAdmin(actor);
 if(!actor.id)return;
 const {rows:[row]}=await client.query(`SELECT l.id FROM learners l WHERE l.id=$1 AND l.archived_at IS NULL AND (EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=l.id) OR EXISTS(SELECT 1 FROM reporting_access r WHERE r.learner_id=l.id AND r.scope='organisation')) FOR UPDATE`,[actor.id]);
 if(!row)throw new CourseError('Organisation admin access is required.',403);
}
export async function saveEmailSettings(actor:UserAdministrator,b:Record<string,unknown>){
 await requireFeature('email_notifications');
 requireEmailAdmin(actor);
 const list=(value:unknown,min:number,max:number,limit:number)=>Array.isArray(value)&&value.length<=limit&&value.every(x=>Number.isSafeInteger(x)&&x>=min&&x<=max)&&new Set(value).size===value.length;
 if(!['off','preview','live'].includes(String(b.mode))||!Number.isSafeInteger(b.revision)||!list(b.expiry_days,1,90,5)||!list(b.deadline_days,1,90,5)||!Number.isSafeInteger(b.invitation_hours)||Number(b.invitation_hours)<1||Number(b.invitation_hours)>168||!Array.isArray(b.enabled)||!b.enabled.every(k=>emailKinds.includes(k))||new Set(b.enabled).size!==b.enabled.length)throw new CourseError('Check the email settings.');
 if(b.mode==='live'&&!emailConnection().ready)throw new CourseError('Live email is not connected. Use Off or Preview.');
 await inTransaction(async client=>{
  await recheckActor(client,actor);
  const {rows:[old]}=await client.query('SELECT * FROM email_settings WHERE id=1 FOR UPDATE');
  if(old.revision!==b.revision)throw new CourseError('These settings changed. Reload before saving.',409);
  const features=(await client.query('SELECT features FROM organisation_settings WHERE id=1')).rows[0].features as Record<string,{policy:string}>;
  const groups:Record<string,string[]>= {assignment_emails:['course_assigned','pathway_assigned'],registration_reminders:['invitation_reminder','account_reminder'],expiry_reminders:['expiry_reminder','expired']};
  for(const [key,kinds] of Object.entries(groups))if(features[key]?.policy==='required'&&kinds.some(k=>!(b.enabled as string[]).includes(k)))throw new CourseError('This feature is managed by Platform Admin.',403);
  if(features.email_notifications?.policy==='required'&&old.mode==='live'&&b.mode!=='live')throw new CourseError('This feature is managed by Platform Admin.',403);

  const enabled=old.enabled as string[],since={...(old.enabled_since as Record<string,string>)};
  for(const kind of b.enabled as string[])if(!enabled.includes(kind))since[kind]=new Date().toISOString();
  await client.query(`UPDATE email_settings SET mode=$1,enabled=$2,expiry_days=$3,deadline_days=$4,invitation_hours=$5,revision=revision+1,updated_by=$6,updated_at=now(),enabled_since=$7,
    active_since=CASE WHEN mode IS DISTINCT FROM $1 THEN now() ELSE active_since END WHERE id=1`,[b.mode,JSON.stringify(b.enabled),JSON.stringify(b.expiry_days),JSON.stringify(b.deadline_days),b.invitation_hours,actor.email,JSON.stringify(since)]);
  // Never carry a queue across modes; other changes are rechecked at dispatch.
  if(old.mode!==b.mode)await client.query("UPDATE email_outbox SET status='cancelled',error_code='settings_changed' WHERE status='queued'");
  await audit(client,actor.email,'settings',{mode:b.mode,enabled:b.enabled,expiry_days:b.expiry_days,deadline_days:b.deadline_days,invitation_hours:b.invitation_hours});
 });
 return emailSettings();
}
export async function createInvitation(actor:UserAdministrator,b:Record<string,unknown>){
 await requireFeature('email_notifications');
 requireEmailAdmin(actor);
 const name=typeof b.name==='string'?b.name.trim().replace(/\s+/g,' '):'',email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(name.length<2||name.length>101||email.length>254||!/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(email))throw new CourseError('Enter your name and a valid email.');
 const store=(await storeDirectory()).find(s=>s.id===b.storeId&&s.active);
 if(!store)throw new CourseError('Choose a store.');
 const id=crypto.randomUUID();
 await inTransaction(async client=>{
  await recheckActor(client,actor);
  if((await client.query('SELECT id FROM learners WHERE lower(email)=$1',[email])).rows.length)throw new CourseError('This email is already registered.',409);
  await client.query('INSERT INTO learning_invitations(id,name,email,store_id,created_by) VALUES($1,$2,$3,$4,$5)',[id,name,email,store.id,actor.email]);
  await audit(client,actor.email,'invitation_prepared',{id,name,email,store_id:store.id});
 });
 return id;
}
export async function changeInvitation(actor:UserAdministrator,id:string,action:'queue'|'cancel'){
 if(action==='queue')await requireFeature('email_notifications');
 requireEmailAdmin(actor);
 await inTransaction(async client=>{
  await recheckActor(client,actor);
  const {rows:[s]}=await client.query('SELECT * FROM email_settings WHERE id=1 FOR UPDATE');
  const {rows:[i]}=await client.query('SELECT * FROM learning_invitations WHERE id=$1 FOR UPDATE',[id]);
  if(!i||i.accepted_at||i.cancelled_at)throw new CourseError('This invitation is no longer available.',409);
  if(action==='queue'){
   if(s.mode!=='live'||!emailConnection().ready||!(s.enabled as string[]).includes('invitation'))throw new CourseError('Live email is not connected. Use Off or Preview.');
   if(i.first_sent_at||(await client.query('SELECT id FROM learners WHERE lower(email)=lower($1)',[i.email])).rows.length)throw new CourseError('This invitation is no longer available.',409);
   if((await client.query("SELECT id FROM email_outbox WHERE event_key=$1 AND status IN ('queued','sending','sent','unknown','failed','cancelled')",['invite:'+id])).rows.length)throw new CourseError('Check the delivery log before trying again.',409);
   await client.query('UPDATE learning_invitations SET requested_at=now() WHERE id=$1',[id]);
  }else{
   await client.query('UPDATE learning_invitations SET cancelled_at=now() WHERE id=$1',[id]);
   await client.query('DELETE FROM learning_invitation_tokens WHERE invitation_id=$1',[id]);
   await client.query("UPDATE email_outbox SET status='cancelled',error_code='invitation_cancelled' WHERE invitation_id=$1 AND status='queued'",[id]);
  }
  await audit(client,actor.email,'invitation_'+action,{id});
 });
}
export async function invitationForToken(token:unknown){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new CourseError('This invitation is no longer available.',400);
 const i=await db().prepare(`SELECT i.id,i.name,i.email,i.store_id,EXISTS(SELECT 1 FROM learners l WHERE lower(l.email)=lower(i.email)) AS registered
 FROM learning_invitations i JOIN learning_invitation_tokens t ON t.invitation_id=i.id WHERE t.token_hash=? AND t.expires_at>now() AND i.cancelled_at IS NULL AND i.accepted_at IS NULL`).bind(digest(token)).first<{id:string;name:string;email:string;store_id:string;registered:boolean}>();
 const store=i&&(await storeDirectory()).find(s=>s.id===i.store_id&&s.active);
 if(!i||!store)throw new CourseError('This invitation is no longer available.',400);
 return {...i,country:store.country,store:store.name};
}
