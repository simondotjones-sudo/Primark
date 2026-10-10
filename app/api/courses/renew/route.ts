import type {NextRequest} from 'next/server';
import {currentLearner} from '@/lib/server';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {sameOrigin} from '@/lib/request-origin';
import {creditError} from '@/lib/credits';
import {renewLearnerCourse} from '@/lib/course-renewals';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){try{
 if(!sameOrigin(request))throw new CourseError('Please make this change from the course page.',403);
 const learner=await currentLearner(request);
 if(!learner)throw new CourseError('Sign in to see your courses.',401);
 if(learner.admin_only)throw new CourseError('Use your personal learner account for training.',403);
 const body=await bodyJson(request,2000);
 if(!body||typeof body.courseId!=='string'||body.courseId.length>200||typeof body.certificateToken!=='string'||!/^[a-f0-9]{64}$/.test(body.certificateToken))throw new CourseError('Invalid request.');
 return json(await renewLearnerCourse(learner.id,body.courseId,body.certificateToken));
}catch(e){return failed(creditError(e));}}
