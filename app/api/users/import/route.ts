import type {NextRequest} from 'next/server';
import {requireUserAdministrator} from '@/lib/user-administration';
import {bodyJson,CourseError,failed,json} from '@/lib/course-admin';
import {importLearners} from '@/lib/learner-import';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){try{
 const actor=await requireUserAdministrator(request);
 const body=await bodyJson(request,600000);
 if(!body||typeof body.csv!=='string'||typeof body.mode!=='string'||(body.revision!==undefined&&(typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))))throw new CourseError('Invalid request.');
 return json(await importLearners(actor,body.csv,body.mode,body.revision));
}catch(error){if(error instanceof CourseError)return failed(error);return json({error:'This change could not be completed. Please try again.'},503);}}
