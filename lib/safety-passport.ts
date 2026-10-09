import type {Certificate} from '@/lib/certificates';

export type SafetyPassportRecord = Pick<Certificate,
 'token'|'certificate_number'|'learner_name'|'course_title'|'country'|'completed_at'|'expires_at'> & {store_name:string};

export function safetyPassportFor(course:{id:string;package_id:string|null;category:string},record:Certificate|undefined,storeName:string):SafetyPassportRecord|null {
 if(course.category.trim().toLowerCase()!=='induction'||!record||record.archived_at||record.cancelled_at||record.course_id!==course.id||record.package_id!==course.package_id)return null;
 return {token:record.token,certificate_number:record.certificate_number,learner_name:record.learner_name,
  course_title:record.course_title,country:record.country,completed_at:record.completed_at,expires_at:record.expires_at,store_name:storeName};
}
