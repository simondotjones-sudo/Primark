import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Exercise the real reporting SQL against isolated Postgres fixtures.
const pg=new PGlite(),dir=mkdtempSync(join(tmpdir(),'learning-time-'));
globalThis.__learningTimeDb={prepare(sql){const run=(args=[])=>({async all(){let n=0;const result=await pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args);return {results:result.rows};}});return {...run(),bind:(...args)=>run(args)};}};
try {
  await pg.exec(`
    CREATE TABLE learners(id text,name text,email text,workday_id text,archived_at text,country text,store_id text,induction_enrolled boolean,started_at text,completed_at text,best_score int);
    CREATE TABLE courses(id text,title text,package_id text,status text,audience_json text,induction_role text,validity_months int,category text,language_code text);
    CREATE TABLE course_packages(id text,status text,scos_json text,course_id text);
    CREATE TABLE scorm_progress(learner_id text,package_id text,sco_id text,status text,completed_at text,score text,total_centiseconds bigint);
    CREATE TABLE course_assignments(learner_id text,course_id text,history_id text);
    CREATE TABLE learner_inductions(learner_id text,course_id text);
    CREATE TABLE assignment_exclusions(learner_id text,course_id text);
    CREATE TABLE assignment_history(id text,previous_id text,due_at timestamptz,quiz_json text,assessor_required boolean,package_id text,course_snapshot jsonb);
    CREATE TABLE certificates(token text,learner_id text,course_id text,package_id text,assignment_id text,completed_at text,expires_at text,archived_at text,cancelled_at text);
    CREATE TABLE course_refresher_assignments(certificate_token text,refresher_course_id text,assignment_id text);
    CREATE TABLE course_quiz_attempts(assignment_id text,passed boolean,correct_count int,question_count int,submitted_at text,id text);
    CREATE TABLE legacy_completions(email text,completed int,completed_at text,store_id text);
    INSERT INTO learners VALUES('person','Person','person@example.test',NULL,NULL,'Ireland','site',true,NULL,NULL,NULL),('other','Other','other@example.test',NULL,NULL,'Ireland','elsewhere',true,NULL,NULL,NULL),('original','Original','original@example.test',NULL,NULL,'Ireland','site',false,NULL,NULL,NULL);
    INSERT INTO courses VALUES('course','Course','pack','published','{"countries":[],"sites":[],"users":[]}','none',NULL,'Safety','en'),('missing','Missing','empty','published','{"countries":[],"sites":[],"users":[]}','none',NULL,'Safety','en');
    INSERT INTO course_packages(id,status,scos_json) VALUES('pack','ready','[{"id":"one"},{"id":"two"}]'),('empty','ready','[{"id":"one"}]');
    UPDATE course_packages SET course_id=CASE WHEN id='pack' THEN 'course' ELSE 'missing' END;
    INSERT INTO course_assignments VALUES('person','course',NULL),('person','missing',NULL),('other','course',NULL);
    INSERT INTO scorm_progress VALUES('person','pack','one','completed','2026-01-01',NULL,90025),('person','pack','two','incomplete',NULL,NULL,180075),('person','pack','removed','completed','2026-01-01',NULL,99999999),('other','pack','one','incomplete',NULL,NULL,500000);
  `);
  const mocks={
    '@/lib/database':'export const db=()=>globalThis.__learningTimeDb;',
    '@/lib/account-type':'export const learnerOnlySql=()=>"true";',
    '@/lib/organisation-settings':'export const organisationSettings=async()=>({exclude_within_deadline:false});',
    '@/lib/store-directory':'export const storeDirectory=async()=>[{id:"site",name:"Site",country:"Ireland"},{id:"elsewhere",name:"Elsewhere",country:"Ireland"}];',
    '@/lib/course-catalogue':'export const inductionFor=()=>null; export const availableInCountry=()=>false;',
  };
  await build({entryPoints:['lib/training-report.ts','lib/training-report-types.ts'],outdir:dir,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},plugins:[{name:'isolated-reporting',setup(b){
    b.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:{path:resolve(args.path.slice(2)+'.ts')});
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
  }}]});
  const report=await import(pathToFileURL(join(dir,'training-report.mjs')));
  const {formatLearningTime,ORIGINAL_INDUCTION}=await import(pathToFileURL(join(dir,'training-report-types.mjs')));
  const selection={category:'all',courseId:'all'};
  const full=await report.trainingReport(['site']);
  assert.equal(full.records.find(r=>r.courseId==='course').learningSeconds,2701);
  assert.equal(full.records.find(r=>r.courseId==='missing').learningSeconds,null);
  assert.equal(full.records.find(r=>r.courseId===ORIGINAL_INDUCTION).learningSeconds,null);
  assert(!full.records.some(r=>r.learnerId==='other'));
  const activity=await report.trainingActivity(['site'],selection,'person@example.test',1);
  assert.equal(activity.records.find(r=>r.courseId==='course').learningSeconds,2701);
  assert.equal((await report.trainingActivity(['site'],selection,'no match',1)).records.length,0);
  await report.trainingOverview(['site']);
  await pg.exec("UPDATE scorm_progress SET total_centiseconds=0 WHERE learner_id='person'");
  assert.equal((await report.trainingReport(['site'])).records.find(r=>r.courseId==='course').learningSeconds,null);
  for(const [seconds,expected] of [[null,'—'],[undefined,'—'],[0,'—'],[-1,'—'],[NaN,'—'],[Infinity,'—'],[0.25,'00:00:01'],[59.9,'00:01:00'],[2701,'00:45:01'],[90061,'25:01:01']])assert.equal(formatLearningTime(seconds),expected);
  for(const path of ['components/training-report.tsx','components/user-activity.tsx'])await transform(readFileSync(path,'utf8'),{loader:'tsx'});
  console.log('PASS: real reporting SQL sums current lessons, excludes obsolete lessons and other sites, preserves unknown time, exposes time in activity/export, and formats long durations. Both changed components compile.');
}finally{await pg.close();delete globalThis.__learningTimeDb;rmSync(dir,{recursive:true,force:true});}
