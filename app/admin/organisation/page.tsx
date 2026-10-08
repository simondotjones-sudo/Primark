import {requireStoreAdministrator} from '@/lib/organisation-administration';
import {redirect} from 'next/navigation';
import OrganisationAdmin from './organisation-admin';
import '../courses/courses.css';
export const dynamic='force-dynamic';
export default async function Page(){try{await requireStoreAdministrator();}catch{redirect('/?login=1&returnTo=%2Fadmin%2Forganisation');}return <OrganisationAdmin/>;}
