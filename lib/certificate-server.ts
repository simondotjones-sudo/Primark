import { db } from '@/lib/database';
import type { Certificate } from '@/lib/certificates';
export const certificateForToken=(token:string)=>/^[a-f0-9]{64}$/.test(token)
  ?db().prepare('SELECT * FROM certificates WHERE token=?').bind(token).first<Certificate>()
  :Promise.resolve(null);
export const certificatesFor=(learnerId:string)=>db().prepare('SELECT * FROM certificates WHERE learner_id=? ORDER BY completed_at DESC,token').bind(learnerId).all<Certificate>();
export const issueCourseCertificate=(learnerId:string,packageId:string)=>db().prepare('SELECT issue_course_certificate(?,?)').bind(learnerId,packageId);
export const issuePassportCertificate=(learnerId:string)=>db().prepare(`
  INSERT INTO certificates(token,learner_id,course_title,learner_name,store_id,country,completed_at,issued_at)
  SELECT certificate_token,id,'Primark Safety Passport',name,store_id,country,completed_at,completed_at
  FROM learners WHERE id=? AND completed_at IS NOT NULL AND certificate_token IS NOT NULL
  ON CONFLICT (token) DO NOTHING`).bind(learnerId);
