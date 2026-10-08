import Player from './player';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {learnerForSession} from '@/lib/server';
import {getAdminUser} from '@/lib/admin-auth';
import './player.css';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{preview?:string}>}){
  const preview=(await searchParams).preview==='1';
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(preview ? !await getAdminUser() : !learner || learner.admin_only)redirect('/');
  return <Player courseId={(await params).id} preview={preview}/>;
}
