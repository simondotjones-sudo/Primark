import baseline from '@/lib/stores.json';
import {db} from '@/lib/database';
export type DirectoryStore = {id:string;name:string;country:string;active:boolean};
export async function storeDirectory(includeArchived=true):Promise<DirectoryStore[]> {
  const overrides=(await db().prepare('SELECT id,name,country,active FROM organisation_stores').all<DirectoryStore>()).results;
  const entries=new Map<string,DirectoryStore>(baseline.map(s=>[s.id,{...s,active:true}]));
  for(const store of overrides)entries.set(store.id,store);
  return [...entries.values()].filter(s=>includeArchived||s.active).sort((a,b)=>a.country.localeCompare(b.country)||a.name.localeCompare(b.name));
}
