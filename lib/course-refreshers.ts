import {db,inTransaction} from './database';
import {activeLearnerSql} from './account-type';

// Each certificate is processed in its own short transaction. A store without
// credits or an unpublished refresher cannot prevent other stores renewing.
export async function syncCourseRefreshers(learnerId:string|null=null){
 const {results}=await db().prepare(`SELECT cert.token FROM certificates cert
  JOIN course_assignments a ON a.history_id=cert.assignment_id
  JOIN learners l ON l.id=cert.learner_id
  JOIN course_refresher_rules r ON r.source_course_id=cert.course_id AND r.country=l.country
  LEFT JOIN course_refresher_assignments e ON e.certificate_token=cert.token
  WHERE (?::text IS NULL OR l.id=?) AND ${activeLearnerSql()}
   AND cert.archived_at IS NULL AND cert.cancelled_at IS NULL AND cert.expires_at::timestamptz<=now()+interval '720 hours'
   AND e.assignment_id IS NULL AND (e.attempted_at IS NULL OR e.attempted_at<=now()-interval '15 minutes')
  ORDER BY e.attempted_at NULLS FIRST,cert.expires_at,cert.token LIMIT 100`).bind(learnerId,learnerId).all<{token:string}>();
 const deadline=Date.now()+20000;
 const counts={checked:0,assigned:0,pending:0,failed:0};
 for(const row of results){
  if(Date.now()>=deadline)break;
  try{
   const outcome=await inTransaction(async client=>{
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL statement_timeout='3s'");
    return (await client.query('SELECT assign_course_refresher($1) AS outcome',[row.token])).rows[0]?.outcome;
   });
   counts.checked++;if(outcome==='assigned')counts.assigned++;else counts.pending++;
  }catch(error){counts.failed++;console.error('Refresher assignment failed',{code:(error as {code?:string}).code});}
 }
 return counts;
}
