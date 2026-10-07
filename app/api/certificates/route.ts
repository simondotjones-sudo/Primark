import { NextRequest } from 'next/server';
import { currentLearner } from '@/lib/server';
import { certificatesFor } from '@/lib/certificate-server';
import { failed,json,CourseError } from '@/lib/course-admin';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
  const learner=await currentLearner(request);
  if(!learner)throw new CourseError('Sign in to see your certificates.',401);
  return json({certificates:(await certificatesFor(learner.id)).results});
}catch(e){return failed(e);}}
