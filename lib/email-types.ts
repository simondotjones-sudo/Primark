export const emailKinds = ['invitation','invitation_reminder','account_ready','account_reminder','course_assigned','pathway_assigned','deadline_reminder','overdue','expiry_reminder','expired','certificate_ready','assessment_pending','manager_digest'] as const;
export type EmailKind = typeof emailKinds[number];
export type EmailMode = 'off' | 'preview' | 'live';
export type EmailSettings = {
  mode: EmailMode; revision: number; active_since: string; enabled: EmailKind[];
  expiry_days: number[]; deadline_days: number[]; invitation_hours: number;
};
export const emailLabels: Record<EmailKind,string> = {
  invitation:'Invitation', invitation_reminder:'Invitation reminder', account_ready:'Account ready', account_reminder:'First sign-in reminder',
  course_assigned:'Course assigned',pathway_assigned:'Pathway assigned',deadline_reminder:'Deadline reminder',overdue:'Training overdue',
  expiry_reminder:'Certificate expiry reminder',expired:'Certificate expired',certificate_ready:'Certificate ready',
  assessment_pending:'Practical assessment required',manager_digest:'Weekly manager summary',
};
export type EmailPayload = {name:string;title?:string;date?:string;days?:number;hours?:number;path?:string;store?:string;overdue?:number;expiring?:number;assessment?:number};
export type EmailCandidate = {event_key:string;kind:EmailKind;recipient_id:string|null;invitation_id:string|null;email:string;payload:EmailPayload;occurred_at:string;ends_at:string};
