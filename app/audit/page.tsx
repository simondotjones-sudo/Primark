import {redirect} from 'next/navigation';
import {getUserAdministrator} from '@/lib/user-administration';
import AuditTrail from '@/components/audit-trail';
import PageHeader from '@/components/page-header';
export const dynamic='force-dynamic';
export default async function Page(){const actor=await getUserAdministrator();if(!actor||(!actor.platformAdmin&&actor.access.scope!=='organisation'))redirect('/');return <div className="shell app-page"><PageHeader title={"Audit trail"} view="audit"/><main className="main"><AuditTrail/></main></div>;}
