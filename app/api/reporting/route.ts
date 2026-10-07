import {storeDirectory} from '@/lib/store-directory';
import { NextRequest } from 'next/server';
import { getReportingAccess, reportingFilter } from '@/lib/reporting-access';
import { CourseError, failed, json } from '@/lib/course-admin';
import { trainingReport } from '@/lib/training-report';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
  const access=await getReportingAccess(request);
  if(!access)throw new CourseError('Reporting access is required.',403);
  const scope=reportingFilter(access,request.nextUrl.searchParams,await storeDirectory());
  return json(await trainingReport(scope.siteIds));
}catch(error){return failed(error);}}
