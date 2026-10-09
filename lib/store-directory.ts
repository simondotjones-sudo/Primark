import baseline from '@/lib/stores.json';
import {db} from '@/lib/database';
import {activeLearnerSql} from '@/lib/account-type';
export type DirectoryStore = {id:string;name:string;country:string;active:boolean;storeCode?:string|null;address?:string|null;adminEmail?:string|null;learnerCount?:number;revision?:string|null};
export async function storeDirectory(includeArchived=true,includeAdmin=false):Promise<DirectoryStore[]> {
  const overrides=(await db().prepare(`SELECT s.id,s.name,s.country,s.active,s.store_code AS "storeCode",s.address,${includeAdmin?'COALESCE(s.admin_email,l.email)':'NULL::text'} AS "adminEmail"${includeAdmin?`,s.updated_at AS revision,(SELECT COUNT(*)::int FROM learners p WHERE p.store_id=s.id AND ${activeLearnerSql('p')}) AS "learnerCount"`:''} FROM organisation_stores s LEFT JOIN learners l ON l.id=s.admin_learner_id`).all<DirectoryStore>()).results;
  const entries=new Map<string,DirectoryStore>(baseline.map(s=>[s.id,s]));
  for(const store of overrides)entries.set(store.id,store);
  return [...entries.values()].filter(s=>includeArchived||s.active).sort((a,b)=>a.country.localeCompare(b.country)||a.name.localeCompare(b.name)||(a.storeCode||'').localeCompare(b.storeCode||''));
}
