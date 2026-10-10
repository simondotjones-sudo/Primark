import {CourseError} from './course-admin';
import {buildScheduledReport} from './scheduled-reports';
import {createHash,randomBytes} from 'node:crypto';
import {inTransaction} from './database';
import type {EmailCandidate} from './email-types';
import {emailConnection,deliverLearningEmail} from './email-delivery';
import {renderLearningEmail} from './email-templates';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function runEmailNotifications(){
 if(!emailConnection().ready)return {queued:0,sent:0,disabled:true};
 const until=Date.now()+20000;
 let queued=0,sent=0;
 await inTransaction(async client=>{
  const {rows:[s]}=await client.query('SELECT * FROM email_settings WHERE id=1 FOR UPDATE');
  if(s.mode!=='live')return;
  await client.query("UPDATE email_outbox SET status='unknown',error_code='worker_interrupted' WHERE status='sending' AND claimed_at<now()-interval '5 minutes'");
  // Preview mode never writes this outbox. Each real event has a durable unique key.
  const result=await client.query(`INSERT INTO email_outbox(event_key,kind,recipient_id,invitation_id,activation)
   SELECT c.event_key,c.kind,c.recipient_id,c.invitation_id,$1 FROM learning_email_candidates() c
   WHERE NOT EXISTS(SELECT 1 FROM email_outbox o WHERE o.event_key=c.event_key) LIMIT 1000 ON CONFLICT DO NOTHING`,[s.active_since]);
  queued=result.rowCount||0;
 });
 for(let count=0;count<50&&Date.now()<until;count++){
  const prepared=await inTransaction(async client=>{
   const {rows:[s]}=await client.query('SELECT * FROM email_settings WHERE id=1 FOR UPDATE');
   if(s.mode!=='live'||!emailConnection().ready)return null;
   const {rows:[job]}=await client.query(`UPDATE email_outbox SET status='sending',claimed_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM email_outbox WHERE status='queued' AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
   if(!job)return null;
   const {rows:[candidate]}=await client.query(`SELECT c.* FROM learning_email_candidates() c WHERE c.event_key=$1 AND $2::timestamptz=$3::timestamptz`,[job.event_key,job.activation,s.active_since]);
   if(!candidate){await client.query("UPDATE email_outbox SET status='cancelled',error_code='no_longer_eligible' WHERE id=$1",[job.id]);return {skip:true as const};}
   const c=candidate as unknown as EmailCandidate;
   if(c.kind==='manager_digest'||c.kind==='country_digest'){
    try{c.payload=await buildScheduledReport(c.kind,c.payload);}
    catch(error){if(!(error instanceof CourseError)||error.status!==409)throw error;
     await client.query("UPDATE email_outbox SET status='cancelled',error_code='report_scope_unavailable' WHERE id=$1",[job.id]);return {skip:true as const};}
   }
   await client.query('UPDATE email_outbox SET to_email=$2 WHERE id=$1',[job.id,c.email]);
   let token:string|undefined;
   if(c.invitation_id){
    token=randomBytes(32).toString('hex');
    await client.query('DELETE FROM learning_invitation_tokens WHERE expires_at<now()');
    await client.query("INSERT INTO learning_invitation_tokens(token_hash,invitation_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[digest(token),c.invitation_id]);
   }
   return {skip:false as const,id:String(job.id),attempts:Number(job.attempts),candidate:c,message:renderLearningEmail(c.kind,c.payload,emailConnection().origin,token)};
  });
  if(!prepared)break;if(prepared.skip)continue;
  const result=await deliverLearningEmail(prepared.candidate.email,prepared.message,prepared.id);
  await inTransaction(async client=>{
   const retry=result.status==='retry'&&prepared.attempts<4;
   const status=retry?'queued':result.status==='retry'?'failed':result.status;
   await client.query(`UPDATE email_outbox SET status=$2,error_code=$3,provider_id=$4,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END,
    next_attempt_at=now()+make_interval(secs=>$5) WHERE id=$1 AND status='sending'`,[prepared.id,status,result.code,result.providerId||null,60*2**prepared.attempts]);
   if(status==='sent'&&prepared.candidate.kind==='invitation')await client.query('UPDATE learning_invitations SET first_sent_at=COALESCE(first_sent_at,now()) WHERE id=$1',[prepared.candidate.invitation_id]);
   await client.query("INSERT INTO email_audit(actor,action,details) VALUES('system',$1,$2)",[status,JSON.stringify({id:prepared.id,kind:prepared.candidate.kind,code:result.code})]);
  });
  if(result.status==='sent')sent++;
 }
 return {queued,sent,disabled:false};
}
