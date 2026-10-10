import {runtimeEnv} from '@/lib/runtime-env';
import deployContext from '@/lib/deploy-context.json';

export function emailConnection(){
  let origin='';
  try {const u=new URL(runtimeEnv('PRIMARK_APP_URL'));if(u.protocol==='https:'&&!u.username&&!u.password)origin=u.origin;}catch{/* Not configured yet. */}
  const token=runtimeEnv('POSTMARK_SERVER_TOKEN'),from=runtimeEnv('POSTMARK_FROM_EMAIL');
  const production=(runtimeEnv('CONTEXT')||deployContext.context)==='production';
  const configured=!!origin&&!!token&&token!=='POSTMARK_API_TEST'&&/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(from);
  return {origin,token,from,configured,production,ready:configured&&production&&runtimeEnv('PRIMARK_EMAIL_DELIVERY')==='enabled'};
}
export type DeliveryResult={status:'sent'|'retry'|'failed'|'unknown';code:string;providerId?:string};
export async function deliverLearningEmail(to:string,message:{Subject:string;HtmlBody:string;TextBody:string},outboxId:string):Promise<DeliveryResult>{
  const c=emailConnection();
  if(!c.ready)return {status:'failed',code:'delivery_disabled'};
  if(!/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(to))return {status:'failed',code:'invalid_recipient'};
  try{
    const response=await fetch('https://api.postmarkapp.com/email',{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','Accept':'application/json','X-Postmark-Server-Token':c.token},body:JSON.stringify({From:c.from,To:to,...message,MessageStream:runtimeEnv('POSTMARK_MESSAGE_STREAM')||'outbound',TrackOpens:false,TrackLinks:'None',Metadata:{notification_id:outboxId}})});
    if(response.status===429)return {status:'retry',code:'rate_limited'};
    // A lost/ambiguous response must never cause an automatic duplicate email.
    if(response.status>=500)return {status:'unknown',code:'provider_uncertain'};
    const result=await response.json();
    if(response.ok&&result.ErrorCode===0&&typeof result.MessageID==='string')return {status:'sent',code:'accepted',providerId:result.MessageID};
    return {status:'failed',code:'provider_'+(Number.isSafeInteger(result.ErrorCode)?result.ErrorCode:response.status)};
  }catch{return {status:'unknown',code:'delivery_uncertain'};}
}
