import type {NextRequest} from 'next/server';
import {getReportingAccess,reportingFilter} from '@/lib/reporting-access';
import {getAdminUser} from '@/lib/admin-auth';
import {storeDirectory} from '@/lib/store-directory';
import {CourseError,failed,json} from '@/lib/course-admin';
import {periodReport} from '@/lib/period-report';
import {periodWorkbook} from '@/lib/period-export';
import {periodReportView} from '@/lib/period-report-view';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
 const access=await getReportingAccess(request);if(!access)throw new CourseError('Reporting access is required.',403);
 const params=request.nextUrl.searchParams,scope=reportingFilter(access,params,await storeDirectory());
 const report=periodReportView(await periodReport(scope.siteIds,params.get('period'),!!await getAdminUser()),{search:params.get('search')||'',zeroOnly:params.get('zeroOnly')==='1',sort:params.get('sort')==='inactive'?'inactive':'store'});
 if(params.get('export')==='xlsx')return new Response(new Uint8Array(await periodWorkbook(report)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="primark-${report.period.id}.xlsx"`,'Cache-Control':'private, no-store'}});
 return json(report);
}catch(e){return failed(e);}}
