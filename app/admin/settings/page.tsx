import {redirect} from 'next/navigation';
import {requireUserAdministrator} from '@/lib/user-administration';
import FeatureSettings from './feature-settings';
import '../courses/courses.css';
import './settings.css';
export const dynamic='force-dynamic';
export default async function Page(){
 try{const actor=await requireUserAdministrator();if(!actor.platformAdmin&&actor.access.scope!=='organisation')redirect('/');}
 catch{redirect('/?login=1&returnTo=%2Fadmin%2Fsettings');}
 return <FeatureSettings/>;
}
