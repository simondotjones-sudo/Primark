import { learnerOnlySql } from '@/lib/account-type';
import type { NextRequest } from 'next/server';
import { db, now } from '@/lib/server';
import { bodyJson, CourseError, failed, json, requireAdmin } from '@/lib/course-admin';
import {getAdminUser} from '@/lib/admin-auth';
import {storeDirectory} from '@/lib/store-directory';
import { requireStoreManager } from '@/lib/store-manager';
import { availableInCountry } from '@/lib/course-catalogue';
import { readyCourses } from '@/lib/course-access';
import type { Person } from '@/lib/course-types';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
  const admin=await getAdminUser();
  const requested=request.nextUrl.searchParams.get('storeId');
  let store;
  if(admin){
    if(!requested){const people=await db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,NOT (${learnerOnlySql()}) AS admin_only FROM learners l ORDER BY name,email`).all<Person>();return json({store:null,people:people.results,courses:[],assignments:[]});}
    store=(await storeDirectory(false)).find(s=>s.id===requested);
    if(!store)throw new CourseError('Choose a store.');
  }else{
    store=(await requireStoreManager(request)).store;
    if(requested&&requested!==store.id)throw new CourseError('You can assign courses only to users in your store.',403);
  }
  const [people,courses,assignments]=await Promise.all([
    db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,NOT (${learnerOnlySql()}) AS admin_only FROM learners l WHERE l.store_id=? ORDER BY name,email`).bind(store.id).all<Person>(),
    readyCourses(),
    db().prepare('SELECT a.learner_id,a.course_id FROM course_assignments a JOIN learners l ON l.id=a.learner_id WHERE l.store_id=?').bind(store.id).all(),
  ]);
  return json({store,people:people.results,assignments:assignments.results,courses:courses.filter(c=>availableInCountry(c,store.country)).map(c=>({id:c.id,title:c.title,englishTitle:c.english_title,category:c.category,languageCode:c.language_code}))});
}catch(error){return failed(error);}}
export async function POST(request:NextRequest){try{
  const admin=await getAdminUser();
  if(admin)await requireAdmin(request);
  const manager=admin?null:await requireStoreManager(request,true);
  const body=await bodyJson(request,100000);
  const store=admin?(await storeDirectory(false)).find(s=>s.id===body.storeId):manager!.store;
  if(!store)throw new CourseError('Choose a store.');
  if(manager&&body.storeId&&body.storeId!==store.id)throw new CourseError('You can assign courses only to users in your store.',403);
  const actor=admin?.email||manager!.learner.id;
  if(!Array.isArray(body.courseIds)||!body.courseIds.length||body.courseIds.length>100||body.courseIds.some((id:unknown)=>typeof id!=='string'))throw new CourseError('Select one or more courses.');
  if(body.allUsers!==true&&(!Array.isArray(body.userIds)||!body.userIds.length||body.userIds.length>10000||body.userIds.some((id:unknown)=>typeof id!=='string')))throw new CourseError('Select users or choose all users.');
  const people=(await db().prepare(`SELECT l.id FROM learners l WHERE l.store_id=? AND ${learnerOnlySql()}`).bind(store.id).all<{id:string}>()).results;
  const ids=new Set(people.map(p=>p.id));
  const userIds:string[]=body.allUsers===true?[...ids]:[...new Set<string>(body.userIds)];
  if(userIds.some(id=>!ids.has(id)))throw new CourseError('You can assign courses only to users in your store.',403);
  if(!userIds.length)throw new CourseError('There are no users in this store yet.');
  const available=new Set((await readyCourses()).filter(c=>availableInCountry(c,store.country)).map(c=>c.id));
  const courseIds=[...new Set<string>(body.courseIds)];
  if(courseIds.some(id=>!available.has(id)))throw new CourseError('Choose published courses available in your country.',403);
  if(userIds.length*courseIds.length>10000)throw new CourseError('Choose fewer courses or users for this assignment.');
  const date=now();
  await db().batch(userIds.flatMap(userId=>courseIds.map(courseId=>db().prepare(`INSERT INTO course_assignments(learner_id,course_id,assigned_by,assigned_at)
    SELECT l.id,c.id,?,? FROM learners l JOIN courses c ON c.id=? JOIN course_packages p ON p.id=c.package_id
    ${admin?'':'JOIN store_managers m ON m.learner_id=? AND m.store_id=l.store_id'}
    WHERE l.id=? AND l.store_id=? AND ${learnerOnlySql()} AND c.status='published' AND p.status='ready'
      AND (c.catalogue_scope='global' OR (c.catalogue_scope='countries' AND c.available_countries_json::jsonb @> ?::jsonb))
    ON CONFLICT(learner_id,course_id) DO NOTHING`).bind(actor,date,courseId,...(admin?[]:[manager!.learner.id]),userId,store.id,JSON.stringify([store.country])))));
  return json({users:userIds.length,courses:courseIds.length});
}catch(error){return failed(error);}}
