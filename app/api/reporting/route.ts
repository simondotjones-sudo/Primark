import {storeDirectory} from '@/lib/store-directory';
import { NextRequest } from 'next/server';
import { getReportingAccess, reportingFilter } from '@/lib/reporting-access';
import { CourseError, failed, json } from '@/lib/course-admin';
import { expiringCertificates, trainingActivity, trainingOverview, trainingReport } from '@/lib/training-report';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {try {
  const access=await getReportingAccess(request);
  if(!access)throw new CourseError('Reporting access is required.',403);
  const params=request.nextUrl.searchParams;
  const scope=reportingFilter(access,params,await storeDirectory());
  const selection={category:params.get('category')||'all',courseId:params.get('course')||'all'};
  const view=params.get('view')||'overview';
  const search=(params.get('search')||'').trim();
  const page=Number(params.get('page')||1);
  if(search.length>200||!Number.isSafeInteger(page)||page<1||page>1000000)throw new CourseError('Check the search and page number.');
  if(view==='overview')return json(await trainingOverview(scope.siteIds,selection));
  if(view==='activity')return json(await trainingActivity(scope.siteIds,selection,search,page));
  if(view==='expiring')return json(await expiringCertificates(scope.siteIds,selection,search,page));
  if(view==='matrix'&&scope.role!=='site')throw new CourseError('Choose a store.',400);
  if(view==='matrix'||view==='export')return json(await trainingReport(scope.siteIds,selection,search));
  throw new CourseError('Choose a reporting view.');
}catch(error){return failed(error);}}
