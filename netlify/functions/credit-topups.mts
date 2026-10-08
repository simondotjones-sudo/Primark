import {getDatabase} from '@netlify/database';
// Scheduled functions have no public HTTP endpoint. Dates are evaluated in the
// corporate accounting timezone, including DST and the 35-day final period.
export default async()=>{
 const result=await getDatabase().pool.query('SELECT store_id,topup_store_credits(store_id) AS added FROM store_credit_accounts WHERE active ORDER BY store_id');
 console.log('Credit top-ups checked',{stores:result.rows.length,creditsAdded:result.rows.reduce((n:number,r:{added:number})=>n+r.added,0)});
};
export const config={schedule:'@hourly'};
