import { getUserAdministrator } from '@/lib/user-administration';
import { redirect } from 'next/navigation';
import ReportingAccessAdmin from './reporting-access-admin';
import '../courses/courses.css';
import './reporting-access.css';

export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!await getUserAdministrator()) redirect('/?login=1');
  return <ReportingAccessAdmin />;
}
