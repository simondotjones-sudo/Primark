import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { learnerForSession } from '@/lib/server';
import { managerStoreFor } from '@/lib/store-manager';
import StoreLearning from './store-learning';
import '../admin/courses/courses.css';
export const dynamic='force-dynamic';
export default async function Page(){
  const learner=await learnerForSession((await cookies()).get('primark_session')?.value);
  if(!learner||!await managerStoreFor(learner.id))redirect('/');
  return <StoreLearning/>;
}
