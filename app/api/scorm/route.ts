import { NextRequest } from 'next/server';
import { currentLearner, db, now, randomToken } from '@/lib/server';
import { sameOrigin } from '@/lib/shot-server';
import { bodyJson, failed, getCourse, isPlatformAdmin, json, CourseError } from '@/lib/course-admin';
import { type Course, type Sco } from '@/lib/course-types';
import { initialData, timeCentiseconds, timeString } from '@/lib/scorm-runtime';
import { canAccessCourse } from '@/lib/course-access';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {try {
 if(!sameOrigin(request))throw new CourseError('Open the course from My Courses.',403);
 const b=await bodyJson(request,100000);
 if(b.action==='launch') {
  const preview=b.preview===true;
  // Independent reads run together; fetch package details with the course.
  const [learner,admin,course]=await Promise.all([
   currentLearner(request),preview?isPlatformAdmin():Promise.resolve(false),
   db().prepare('SELECT c.*,p.scos_json,p.status AS package_status FROM courses c LEFT JOIN course_packages p ON p.id=c.package_id WHERE c.id=?').bind(b.courseId).first<Course&{scos_json:string;package_status:string}>(),
  ]);
  if(preview?!admin:!learner)throw new CourseError('Sign in to launch this course.',401);
  if(!course?.package_id)throw new CourseError('Course not available.',404);
  if(!preview&&!await canAccessCourse(course,learner!))throw new CourseError('This course is not assigned to you.',403);
  if(course.package_status!=='ready')throw new CourseError('This package is not ready.');
  const pack={id:course.package_id};
  const scos=JSON.parse(course.scos_json) as Sco[];const sco=scos.find(s=>s.id===b.scoId)||scos[0];
  const old=preview?null:await db().prepare('SELECT * FROM scorm_progress WHERE learner_id=? AND package_id=? AND sco_id=?').bind(learner!.id,pack.id,sco.id).first<any>();
  const token=randomToken(),expires=new Date(Date.now()+8*3600000).toISOString();
  const data=initialData(preview?'preview':learner!.id,preview?'Course preview':learner!.name,sco.mastery,sco.launchData,old?JSON.parse(old.data_json):{},timeString(old?.total_centiseconds||0));
  const statements=[db().prepare('INSERT INTO scorm_launches(token,course_id,package_id,learner_id,sco_id,preview,seed_json,base_time,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(token,course.id,pack.id,preview?null:learner!.id,sco.id,preview?1:0,JSON.stringify(data),old?.total_centiseconds||0,expires)];
  if(!preview)statements.push(db().prepare(`INSERT INTO scorm_progress(learner_id,package_id,sco_id,active_launch,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(learner_id,package_id,sco_id) DO UPDATE SET active_launch=excluded.active_launch,updated_at=excluded.updated_at`).bind(learner!.id,pack.id,sco.id,token,now()));
  await db().batch(statements);
  const split=sco.href.search(/[?#]/);const path=split<0?sco.href:sco.href.slice(0,split),suffix=split<0?'':sco.href.slice(split);
  return json({token,title:course.title,scos,scoId:sco.id,preview,url:`/scorm-content/${token}/${path.split('/').map(encodeURIComponent).join('/')}${suffix}`});
 }
 if(b.action!=='save')throw new CourseError('Unknown action.');
 const learner=await currentLearner(request);
 const launch=await db().prepare('SELECT * FROM scorm_launches WHERE token=? AND expires_at>?').bind(b.token,now()).first<any>();
 if(!launch)throw new CourseError('Your course session expired. Reopen the course to continue.',401);
 if(launch.preview){if(!await isPlatformAdmin())throw new CourseError('Admin sign-in required.',403);return json({saved:true,preview:true});}
 if(!learner||learner.id!==launch.learner_id)throw new CourseError('Sign in again to save your progress.',401);
 const course=await getCourse(launch.course_id);if(!course||course.package_id!==launch.package_id||!await canAccessCourse(course,learner))throw new CourseError('This course assignment has changed. Return to My Courses.',403);
 if(!Number.isSafeInteger(b.sequence)||b.sequence<=0)throw new CourseError('Invalid save sequence.');
 if(b.sequence<=launch.sequence)return json({saved:true});
 const data=b.data as Record<string,string>;
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>600||Object.entries(data).some(([k,v])=>!k.startsWith('cmi.')||typeof v!=='string'||v.length>4096))throw new CourseError('The course sent invalid progress data.');
 const status=data['cmi.core.lesson_status']||'incomplete';if(!['passed','completed','failed','incomplete','browsed','not attempted'].includes(status))throw new CourseError('The course sent an invalid completion status.');
 const raw=data['cmi.core.score.raw']||'';if(raw!==''&&!Number.isFinite(Number(raw)))throw new CourseError('The course sent an invalid score.');
 const duration=data['cmi.core.session_time']||'0000:00:00.00';if(!/^\d{2,4}:[0-5]\d:[0-5]\d(?:\.\d{1,2})?$/.test(duration))throw new CourseError('Invalid session duration.');
 const result=await db().batch([
  db().prepare("SELECT token FROM scorm_launches WHERE token=? FOR UPDATE").bind(b.token),
  db().prepare(`UPDATE scorm_progress SET data_json=?,status=?,score=?,total_centiseconds=?,updated_at=?,completed_at=CASE WHEN ? IN ('passed','completed') THEN COALESCE(completed_at,?) ELSE completed_at END WHERE learner_id=? AND package_id=? AND sco_id=? AND active_launch=? AND EXISTS(SELECT 1 FROM scorm_launches WHERE token=? AND sequence<?)`)
  .bind(JSON.stringify(data),status,raw||null,launch.base_time+timeCentiseconds(duration),now(),status,now(),learner.id,launch.package_id,launch.sco_id,b.token,b.token,b.sequence),
  db().prepare('UPDATE scorm_launches SET sequence=? WHERE token=? AND sequence<?').bind(b.sequence,b.token,b.sequence)
 ]);
 if(!result[1].meta.changes)throw new CourseError('This lesson was opened in another tab. Reopen it here to continue saving.',409);
 return json({saved:true,status});
}catch(e){return failed(e);} }
