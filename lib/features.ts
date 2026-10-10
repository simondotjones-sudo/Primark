import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';
import {featureCatalogue,type FeatureId,type FeatureChoices} from '@/lib/feature-catalogue';
export async function featureChoices(){
 const row=await db().prepare('SELECT * FROM organisation_settings WHERE id=1').first<Record<string,unknown>>();
 if(!row)throw new CourseError('Organisation settings are unavailable.',503);
 const choices=structuredClone(row.features) as FeatureChoices;
 for(const feature of featureCatalogue)if('legacy' in feature)choices[feature.id].enabled=!!row[feature.legacy];
 return {choices,revision:Number(row.revision)};
}
export async function featureEnabled(id:FeatureId){return !!(await db().prepare('SELECT feature_enabled(?) AS enabled').bind(id).first<{enabled:boolean}>())?.enabled;}
export async function requireFeature(id:FeatureId){if(!await featureEnabled(id))throw new CourseError('This feature is switched off in Settings.',403);}
