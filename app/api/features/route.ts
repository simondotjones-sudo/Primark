import type {NextRequest} from 'next/server';
import {currentLearner} from '@/lib/server';
import {getAdminUser} from '@/lib/admin-auth';
import {CourseError,failed,json} from '@/lib/course-admin';
import {featureChoices} from '@/lib/features';
import {featureCatalogue,effectiveFeature} from '@/lib/feature-catalogue';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
 if(!await currentLearner(request)&&!await getAdminUser())throw new CourseError('Sign in first.',403);
 const {choices}=await featureChoices();
 return json({features:Object.fromEntries(featureCatalogue.map(f=>[f.id,effectiveFeature(choices,f.id)]))});
}catch(e){return failed(e);}}
