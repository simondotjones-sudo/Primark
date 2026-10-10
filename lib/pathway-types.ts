export type PathwayRule={jobRoles?:string[];enabled:boolean;scope:'all'|'countries'|'sites';countries:string[];sites:string[];startedFrom:string|null;startedTo:string|null};
export type PathwayItem={courseId:string;stage:number};
export type Pathway={id:string;name:string;description:string;items:PathwayItem[];deadline_days:number|null;award_certificate:boolean;archived:boolean;revision:number;assignment_rule?:PathwayRule};
export type PathwayCourse={courseId:string;title:string;stage:number;completedAt:string|null;startedAt:string|null;awaitingAssessment:boolean;locked:boolean;expired:boolean;available:boolean};
export type PathwayEnrolment={id:string;pathway_id:string;name:string;description:string;learner_id:string;learner_name:string;email:string;workday_id:string|null;store_id:string;country:string;assigned_at:string;due_at:string|null;completed_at:string|null;certificate_token:string|null;courses:PathwayCourse[]};
export function pathwayStatus(e:PathwayEnrolment){return e.completed_at?'Complete':e.courses.some(c=>c.awaitingAssessment)?'Awaiting assessment':e.courses.some(c=>c.startedAt||c.completedAt)?'In progress':'Not started';}
export function pathwayOverdue(e:PathwayEnrolment){return !e.completed_at&&!!e.due_at&&Date.parse(e.due_at)<Date.now();}
