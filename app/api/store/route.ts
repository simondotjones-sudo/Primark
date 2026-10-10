import {inTransaction} from '@/lib/database';
import {creditAccount,creditError,lockCreditActor} from '@/lib/credits';
import {requireUserAdministrator} from '@/lib/user-administration';
import { learnerOnlySql, activeLearnerSql } from '@/lib/account-type';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/server';
import { bodyJson, CourseError, failed, json, requireAdmin } from '@/lib/course-admin';
import {getAdminUser} from '@/lib/admin-auth';
import {storeDirectory} from '@/lib/store-directory';
import { requireStoreManager } from '@/lib/store-manager';
import {storeAssignments} from '@/lib/store-assignments';
import { availableInCountry } from '@/lib/course-catalogue';
import { readyCourses } from '@/lib/course-access';
import type { Person } from '@/lib/course-types';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
  const admin=await getAdminUser();
  const requested=request.nextUrl.searchParams.get('storeId');
  let store;
  if(admin){
    if(!requested){const people=await db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,NOT (${learnerOnlySql()}) AS admin_only FROM learners l WHERE l.archived_at IS NULL ORDER BY name,email`).all<Person>();return json({store:null,people:people.results,courses:[],assignments:[]});}
    store=(await storeDirectory(false)).find(s=>s.id===requested);
    if(!store)throw new CourseError('Choose a store.');
  }else{
    store=(await requireStoreManager(request)).store;
    if(requested&&requested!==store.id)throw new CourseError('You can assign courses only to users in your store.',403);
  }
  const [people,courses,assignments]=await Promise.all([
    db().prepare(`SELECT l.id,l.name,l.email,l.country,l.store_id,NOT (${learnerOnlySql()}) AS admin_only FROM learners l WHERE l.store_id=? AND l.archived_at IS NULL ORDER BY name,email`).bind(store.id).all<Person>(),
    readyCourses(),
    storeAssignments(store.id),
  ]);
  return json({store,credits:await creditAccount(store.id),people:people.results,assignments,courses:courses.filter(c=>availableInCountry(c,store.country)).map(c=>({id:c.id,title:c.title,englishTitle:c.english_title,category:c.category,languageCode:c.language_code,lessonCount:c.lesson_count??null,validityMonths:c.validity_months??null}))});
}catch(error){return failed(creditError(error));}}
export async function POST(request:NextRequest){try{
  const admin=await getAdminUser();
  if(admin)await requireAdmin(request);
  const manager=admin?null:await requireStoreManager(request,true);
  const body=await bodyJson(request,100000);
  const store=admin?(await storeDirectory(false)).find(s=>s.id===body.storeId):manager!.store;
  if(!store)throw new CourseError('Choose a store.');
  if(manager&&body.storeId&&body.storeId!==store.id)throw new CourseError('You can assign courses only to users in your store.',403);
  if(!Array.isArray(body.courseIds)||!body.courseIds.length||body.courseIds.length>100||body.courseIds.some((id:unknown)=>typeof id!=='string'))throw new CourseError('Select one or more courses.');
  if(body.allUsers!==true&&(!Array.isArray(body.userIds)||!body.userIds.length||body.userIds.length>10000||body.userIds.some((id:unknown)=>typeof id!=='string')))throw new CourseError('Select users or choose all users.');
  const people=(await db().prepare(`SELECT l.id FROM learners l WHERE l.store_id=? AND ${activeLearnerSql()}`).bind(store.id).all<{id:string}>()).results;
  const ids=new Set(people.map(p=>p.id));
  const userIds:string[]=body.allUsers===true?[...ids]:[...new Set<string>(body.userIds)];
  if(userIds.some(id=>!ids.has(id)))throw new CourseError('You can assign courses only to users in your store.',403);
  if(!userIds.length)throw new CourseError('There are no users in this store yet.');
  const ready=await readyCourses();
  const available=new Set(ready.filter(c=>availableInCountry(c,store.country)).map(c=>c.id));
  const courseIds=[...new Set<string>(body.courseIds)];
  if(courseIds.some(id=>!available.has(id)))throw new CourseError('Choose published courses available in your country.',403);
  if(userIds.length*courseIds.length>10000)throw new CourseError('Choose fewer courses or users for this assignment.');
  const administrator=await requireUserAdministrator(request);
  const added=await inTransaction(async client=>{
    await lockCreditActor(client,administrator,store.id);
    await client.query(`SELECT l.id FROM learners l WHERE l.id=ANY($1::text[]) AND l.store_id=$2 AND ${activeLearnerSql()} ORDER BY l.id FOR UPDATE`,[userIds,store.id]);
    let count=0;
    for(const userId of [...userIds].sort()){
      const {rows:[person]}=await client.query(`SELECT l.id FROM learners l WHERE l.id=$1 AND l.store_id=$2 AND ${activeLearnerSql()} FOR UPDATE`,[userId,store.id]);
      if(!person)continue;
      await client.query('SELECT sync_credit_assignments($1)',[userId]);
      for(const courseId of [...courseIds].sort()){
        const {rows:[course]}=await client.query(`SELECT c.id FROM courses c JOIN course_packages p ON p.id=c.package_id
          WHERE c.id=$1 AND c.status='published' AND p.status='ready' AND (c.catalogue_scope='global' OR
          (c.catalogue_scope='countries' AND jsonb_exists(c.available_countries_json::jsonb,$2)))`,[courseId,store.country]);
        if(!course)continue;
        const {rows:[result]}=await client.query('SELECT assign_credit_course($1,$2,$3) AS added',[userId,courseId,administrator.email]);
        if(result.added)count++;
      }
    }
    return count;
  });
  const assignments=await storeAssignments(store.id,await readyCourses(),userIds);
  const selectedCourses=new Set(courseIds);
  const assignedTotal=assignments.filter(a=>selectedCourses.has(a.course_id)).length;
  const alreadyAssigned=Math.max(0,assignedTotal-added),unavailable=Math.max(0,userIds.length*courseIds.length-assignedTotal);
  return json({users:userIds.length,courses:courseIds.length,added,alreadyAssigned,unavailable,assignments,credits:await creditAccount(store.id)});
}catch(error){return failed(creditError(error));}}
