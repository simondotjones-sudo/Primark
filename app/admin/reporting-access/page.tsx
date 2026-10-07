import { requireAdminUser } from '@/lib/admin-auth';
import ReportingAccessAdmin from './reporting-access-admin';
import '../courses/courses.css';
import './reporting-access.css';

export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireAdminUser('/admin/reporting-access');
  return <ReportingAccessAdmin />;
}
