import {db} from '@/lib/database';
export async function hasAssessorAccess(id:string){return !!await db().prepare('SELECT learner_id FROM assessor_accounts WHERE learner_id=?').bind(id).first();}
