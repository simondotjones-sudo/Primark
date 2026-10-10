import {redirect} from 'next/navigation';
import {requireUserAdministrator} from '@/lib/user-administration';
import Recognition from './recognition';
import '../courses/courses.css';
export const dynamic='force-dynamic';
export default async function Page(){try{const a=await requireUserAdministrator();if(!a.platformAdmin&&a.access.scope!=='organisation')redirect('/');}catch{redirect('/?login=1');}return <Recognition/>;}
