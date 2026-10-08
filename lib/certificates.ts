export type Certificate = {
  archived_at?:string|null;cancelled_at?:string|null;
  token:string; certificate_number:number; learner_id:string; course_id:string|null; package_id:string|null;
  course_revision:number|null; course_title:string; language_code:string;
  learner_name:string; store_id:string; country:string; completed_at:string;
  validity_months:number|null; expires_at:string|null; issued_at:string;
};
export type CertificateStatus = 'Valid' | 'Expiring soon' | 'Expired';
export function certificateStatus(expiresAt:string|null, at=Date.now()):CertificateStatus {
  if(!expiresAt)return 'Valid';
  const expiry=new Date(expiresAt).getTime();
  return expiry<=at?'Expired':expiry-at<=30*86400000?'Expiring soon':'Valid';
}
export function certificateDate(value:string|null) {
  return value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value)):'No expiry';
}
export function renewalLabel(months:number|null) {
  return months===null?'No renewal required':months===12?'Every year':months%12===0?`Every ${months/12} years`:`Every ${months} ${months===1?'month':'months'}`;
}

export const certificateId=(number:number)=>'PR-'+String(number).padStart(7,'0');
