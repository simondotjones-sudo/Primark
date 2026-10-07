import { requireAdminUser } from '@/lib/admin-auth';
import CourseAdmin from './course-admin';
import './courses.css';
export const dynamic='force-dynamic';
export default async function Page(){await requireAdminUser('/admin/courses');return <CourseAdmin/>;}
