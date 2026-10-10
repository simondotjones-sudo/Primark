export type FeaturePolicy = 'disabled' | 'optional' | 'required';
export type FeatureChoice = {policy:FeaturePolicy;enabled:boolean};
export const featureCatalogue = [
 {id:'pathways',category:'Learning',name:'Learning pathways',description:'Group courses and control their order. Existing assigned pathways remain available.',legacy:'pathways_enabled'},
 {id:'pathway_rules',category:'Learning',name:'Automatic pathway assignments',description:'Assign pathways using country, store and start-date rules.',parent:'pathways'},
 {id:'renewals',category:'Learning',name:'Course renewals',description:'Let learners restart eligible courses before expiry. Previous completions are retained.'},
 {id:'refreshers',category:'Learning',name:'Automatic refresher courses',description:'Assign the configured refresher course 30 days before expiry.'},
 {id:'quizzes',category:'Assessments & certification',name:'Course quizzes',description:'Add quizzes to courses. Existing quiz requirements remain in force when switched off.'},
 {id:'assessor',category:'Assessments & certification',name:'Assessor sign-off',description:'Configure practical sign-off for courses. Existing requirements and outstanding assessments remain in force.'},
 {id:'assessment_evidence',category:'Assessments & certification',name:'Practical assessment evidence',description:'Upload evidence with practical assessments. Saved evidence remains accessible.'},
 {id:'pathway_certificates',category:'Assessments & certification',name:'Pathway certificates',description:'Award certificates for new pathway enrolments. Existing awards and promised certificates are retained.',parent:'pathways'},
 {id:'bulk_import',category:'Learner management',name:'Bulk learner import',description:'Create or update learners from a CSV file.'},
 {id:'lifecycle',category:'Learner management',name:'Joiner, mover and leaver handling',description:'Record transfers, departures and rejoining. Basic account administration remains available.'},
 {id:'auto_archive',category:'Learner management',name:'Automatic archiving',description:'Archive learners inactive for three years. Training history is retained.',legacy:'auto_archive_enabled'},
 {id:'email_notifications',category:'Communications',name:'Learning email notifications',description:'Allow learning emails and invitations. Live delivery also requires a connected email provider.'},
 {id:'assignment_emails',category:'Communications',name:'Assignment emails',description:'Notify learners when courses or pathways are assigned.',parent:'email_notifications'},
 {id:'registration_reminders',category:'Communications',name:'Registration reminders',description:'Remind invitees and users who have not activated their account.',parent:'email_notifications'},
 {id:'expiry_reminders',category:'Communications',name:'Certificate expiry emails',description:'Send reminders before expiry and a course-expired email.',parent:'email_notifications'},
 {id:'scheduled_reports',category:'Reporting & compliance',name:'Scheduled reports',description:'Email scheduled training reports to authorised administrators.',parent:'email_notifications'},
 {id:'weekly_store_reports',category:'Reporting & compliance',name:'Weekly store overdue reports',description:'Send store managers an overdue learner list and training summary.',parent:'scheduled_reports'},
 {id:'monthly_country_reports',category:'Reporting & compliance',name:'Monthly country compliance reports',description:'Send current country compliance summaries to organisation and country administrators.',parent:'scheduled_reports'},
 {id:'learning_time',category:'Reporting & compliance',name:'Learning-time reporting',description:'Show recorded learning time in reports. Stored SCORM tracking is retained.'},
 {id:'site_matrix',category:'Reporting & compliance',name:'Site matrix report',description:'Show learner-by-course completion and export training records.'},
 {id:'credit_reporting',category:'Reporting & compliance',name:'Credit reporting',description:'Show period assignment and credit reports.'},
 {id:'credits',category:'Reporting & compliance',name:'Course credits',description:'Charge credits for new assignments and renewals. Existing transactions are retained.',legacy:'credits_enabled'},
 {id:'exclude_within_deadline',category:'Reporting & compliance',name:'Exclude courses within deadline',description:'Exclude unfinished courses still within their deadline from compliance. Expired certificates still count.',legacy:'exclude_within_deadline'},
] as const;
export type FeatureId = typeof featureCatalogue[number]['id'];
export type FeatureChoices = Record<FeatureId,FeatureChoice>;
export function effectiveFeature(choices:FeatureChoices,id:FeatureId):boolean {
 const choice=choices[id],feature=featureCatalogue.find(f=>f.id===id)!;
 return !!choice&&choice.policy!=='disabled'&&(choice.policy==='required'||choice.enabled)&&(!('parent' in feature)||effectiveFeature(choices,feature.parent));
}
