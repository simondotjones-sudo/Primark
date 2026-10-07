import {requireAdminUser} from '@/lib/admin-auth';
import OrganisationAdmin from './organisation-admin';
import '../courses/courses.css';
export const dynamic='force-dynamic';
export default async function Page(){await requireAdminUser('/admin/organisation');return <OrganisationAdmin/>;}
