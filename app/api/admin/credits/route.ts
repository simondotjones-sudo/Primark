import type {NextRequest} from 'next/server';
import {db,inTransaction} from '@/lib/database';
import {bodyJson,CourseError,failed,json,requireAdmin} from '@/lib/course-admin';
import {requireUserAdministrator} from '@/lib/user-administration';
import {accountingPeriods} from '@/lib/period-report';
export const dynamic='force-dynamic';
export async function GET(){try{await requireAdmin();return json({periods:await accountingPeriods(),rates:(await db().prepare('SELECT id,effective_at::text AS "effectiveAt",cents,actor FROM credit_rates ORDER BY effective_at DESC').all()).results});}catch(e){return failed(e);}}
export async function POST(request:NextRequest){try{
 await requireAdmin(request);const actor=await requireUserAdministrator(request),b=await bodyJson(request,10000);
 if(!b||!['price','topup','calendar'].includes(b.action))throw new CourseError('Invalid request.');
 await inTransaction(async client=>{
  if(actor.id){const {rows:[user]}=await client.query('SELECT l.id FROM learners l JOIN platform_admins p ON p.learner_id=l.id WHERE l.id=$1 AND l.archived_at IS NULL FOR UPDATE OF l',[actor.id]);if(!user)throw new CourseError('Platform admin sign-in is required.',403);}
  if(b.action==='price'){
   const date=new Date(b.effectiveAt);
   if(!Number.isInteger(b.cents)||b.cents<0||b.cents>1000000||!Number.isFinite(date.getTime())||date.getTime()<Date.now()-60000)throw new CourseError('Choose a future price date and a valid EUR amount.');
   await client.query('INSERT INTO credit_rates(id,effective_at,cents,actor) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),date.toISOString(),b.cents,actor.email]);
  }else if(b.action==='topup'){
   if(typeof b.storeId!=='string'||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500)throw new CourseError('Enter a top-up reason.');
   const {rows:[a]}=await client.query('SELECT * FROM store_credit_accounts WHERE store_id=$1 AND active FOR UPDATE',[b.storeId]);
   if(!a)throw new CourseError('Choose a store.');
   const amount=Math.max(0,Number(a.target)-Number(a.balance));
   if(amount){await client.query('UPDATE store_credit_accounts SET balance=balance+$2 WHERE store_id=$1',[b.storeId,amount]);await client.query("INSERT INTO credit_ledger(id,store_id,kind,credits,recorded_at,actor,note) VALUES($1,$2,'manual_topup',$3,now(),$4,$5)",[crypto.randomUUID(),b.storeId,amount,actor.email,b.reason.trim()]);}
  }else{
   if(typeof b.yearLabel!=='string'||!/^\d{4}\/\d{4}$/.test(b.yearLabel)||!Array.isArray(b.periods)||b.periods.length!==13)throw new CourseError('Provide all 13 accounting periods.');
   await client.query('LOCK TABLE accounting_periods IN EXCLUSIVE MODE');
   let previous='';
   for(let i=0;i<13;i++){
    const p=b.periods[i];
    if(!p||typeof p.startsOn!=='string'||typeof p.endsOn!=='string')throw new CourseError('Provide all 13 accounting periods.');
    const start=new Date(p.startsOn+'T00:00:00Z'),end=new Date(p.endsOn+'T00:00:00Z');
    const days=(end.getTime()-start.getTime())/86400000+1;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.startsOn)||!/^\d{4}-\d{2}-\d{2}$/.test(p.endsOn)||!Number.isFinite(days)||!(days===28||(i===12&&days===35))||start.getUTCDay()!==0||start.toISOString().slice(0,10)!==p.startsOn||end.toISOString().slice(0,10)!==p.endsOn||(previous&&p.startsOn!==previous)||start.getTime()<=Date.now())throw new CourseError('Check the accounting dates: periods must be consecutive Sunday-to-Saturday weeks in the future.');
    previous=new Date(end.getTime()+86400000).toISOString().slice(0,10);
    const {rows:overlap}=await client.query('SELECT id FROM accounting_periods WHERE starts_on<=$2::date AND ends_on>=$1::date',[p.startsOn,p.endsOn]);
    if(overlap.length)throw new CourseError('These accounting dates overlap an existing calendar.');
    await client.query('INSERT INTO accounting_periods VALUES($1,$2,$3,$4,$5)',[b.yearLabel.replace('/','-')+'-P'+(i+1),b.yearLabel,i+1,p.startsOn,p.endsOn]);
   }
  }
 });
 return json({ok:true});
}catch(e){if((e as {code?:string}).code==='23505')return failed(new CourseError('This configuration already exists.',409));return failed(e);}}
