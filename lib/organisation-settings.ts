import {db} from '@/lib/database';
export type OrganisationSettings={credits_enabled:boolean;auto_archive_enabled:boolean;exclude_within_deadline:boolean;revision:number};
export async function organisationSettings(){
 return (await db().prepare('SELECT credits_enabled,auto_archive_enabled,exclude_within_deadline,revision FROM organisation_settings WHERE id=1').first<OrganisationSettings>())!;
}
