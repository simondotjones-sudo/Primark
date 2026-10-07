import type { NextRequest } from 'next/server';
import { db, now } from '@/lib/server';
import { bodyJson, CourseError, failed, json } from '@/lib/course-admin';
import { requireStoreManager } from '@/lib/store-manager';
import { availableInCountry } from '@/lib/course-catalogue';
import { readyCourses } from '@/lib/course-access';
import type { Person } from '@/lib/course-types';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
  const {store}=await requireStoreManager(request);
  const [people,courses,assignments]=await Promise.all([
    db().prepare('SELECT id,name,email,country,store_id FROM learners WHERE store_id=? ORDER BY name,email').bind(store.id).all<Person>(),
    readyCourses(),
    db().prepare('SELECT a.learner_id,a.course_id FROM course_assignments a JOIN learners l ON l.id=a.learner_id WHERE l.store_id=?').bind(store.id).all(),
  ]);
  return json({store,people:people.results,assignments:assignments.results,courses:courses.filter(c=>availableInCountry(c,store.country)).map(c=>({id:c.id,title:c.title,englishTitle:c.english_title,category:c.category,languageCode:c.language_code}))});
}catch(error){return failed(error);}}
export async function POST(request:NextRequest){try{
  const {learner,store}=await requireStoreManager(request,true);
  const body=await bodyJson(request,100000);
  if(!Array.isArray(body.courseIds)||!body.courseIds.length||body.courseIds.length>100||body.courseIds.some((id:unknown)=>typeof id!=='string'))throw new CourseError('Select one or more courses.');
  if(body.allUsers!==true&&(!Array.isArray(body.userIds)||!body.userIds.length||body.userIds.length>10000||body.userIds.some((id:unknown)=>typeof id!=='string')))throw new CourseError('Select users or choose all users.');
  const people=(await db().prepare('SELECT id FROM learners WHERE store_id=?').bind(store.id).all<{id:string}>()).results;
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
    JOIN store_managers m ON m.learner_id=? AND m.store_id=l.store_id
    WHERE l.id=? AND l.store_id=? AND c.status='published' AND p.status='ready'
      AND (c.catalogue_scope='global' OR (c.catalogue_scope='countries' AND c.available_countries_json::jsonb @> ?::jsonb))
    ON CONFLICT(learner_id,course_id) DO NOTHING`).bind(learner.id,date,courseId,learner.id,userId,store.id,JSON.stringify([store.country])))));
  return json({users:userIds.length,courses:courseIds.length});
}catch(error){return failed(error);}}
