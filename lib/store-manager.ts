import type { NextRequest } from 'next/server';
import { currentLearner, db } from '@/lib/server';
import {storeDirectory} from '@/lib/store-directory';
import { CourseError } from '@/lib/course-admin';
import { sameOrigin } from '@/lib/shot-server';

export async function managerStoreFor(learnerId:string) {
  const row=await db().prepare('SELECT store_id FROM store_managers WHERE learner_id=?').bind(learnerId).first<{store_id:string}>();
  return row ? (await storeDirectory(false)).find(s=>s.id===row.store_id)||null : null;
}
export async function requireStoreManager(request:NextRequest,write=false) {
  if(write&&!sameOrigin(request))throw new CourseError('Please use the My store page.',403);
  const learner=await currentLearner(request);
  const store=learner?await managerStoreFor(learner.id):null;
  if(!learner||!store)throw new CourseError('Store Manager access is required.',403);
  return {learner,store};
}
