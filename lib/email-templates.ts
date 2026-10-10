import {emailLabels,type EmailKind,type EmailPayload} from '@/lib/email-types';
import {tr} from '@/lib/ui-copy';
import {languageDirection,type Language} from '@/lib/i18n';

const escape = (value:unknown) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderLearningEmail(kind:EmailKind|'password_reset',p:EmailPayload,origin:string,invitationToken?:string){
  const date=p.date?new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeZone:'Europe/London'}).format(new Date(p.date)):'';
  const title=p.title||'your training';
  let subject=kind==='password_reset'?'Reset your Primark password':emailLabels[kind],body='',button='Open My Courses',path=p.path||'/?courses=1';
  switch(kind){
    case 'invitation':body='You have been invited to Primark Safety Passport. Create your account to access your assigned training.';button='Create your account';break;
    case 'invitation_reminder':body=`Your invitation is still waiting. It has been ${p.hours||48} hours since we invited you to create your Primark Safety Passport account.`;button='Create your account';break;
    case 'account_ready':body='Your Primark Safety Passport account is ready. Sign in using your email or Workday ID. If you have not set a password, choose Forgot password on the login page.';button='Sign in';break;
    case 'account_reminder':body=`Your account is ready, but you have not signed in yet. It has been ${p.hours||48} hours since your welcome email. Sign in to see your training, or choose Forgot password to set a password.`;button='Sign in';break;
    case 'course_assigned':subject='New course assigned';body=`You have been assigned ${title}.${date?' Please complete it by '+date+'.':''}`;break;
    case 'pathway_assigned':subject='New learning pathway assigned';body=`You have been assigned ${title}.${date?' Please complete the pathway by '+date+'.':''} Open My Courses to view its courses and required order.`;break;
    case 'deadline_reminder':subject=`Training due in ${p.days} day${p.days===1?'':'s'}`;body=`${title} is due on ${date}. Please complete any outstanding learning and required practical assessment.`;break;
    case 'overdue':body=`${title} was due on ${date} and is still outstanding. Please complete it, or speak with your manager if you need help.`;break;
    case 'expiry_reminder':subject=`Certificate expires in ${p.days} days`;body=`Your certificate for ${title} expires on ${date}. Open My Courses to complete the required renewal or refresher. If it is not available, contact your manager.`;break;
    case 'expired':subject='Course certificate expired';body=`Your certificate for ${title} expired on ${date}. Please complete the required renewal or refresher. Your previous training record is retained.`;break;
    case 'certificate_ready':body=`You have completed ${title}. Your certificate is now available in Primark Safety Passport.`;button='View your training';break;
    case 'assessment_pending':body=`You have completed the online theory for ${title}. Your certificate will be issued after an authorised assessor records a successful practical assessment. Please arrange this with your manager.`;break;
    case 'manager_digest':body=`${p.store||'Your store'}: ${p.overdue||0} overdue course assignments, ${p.expiring||0} certificates expiring within 30 days, and ${p.assessment||0} assignments awaiting practical assessment. Open Reporting to review your store's records.`;button='Open Reporting';break;
    case 'country_digest':body=`${p.store||'Your country'}: current training compliance summary.`;button='Open Reporting';break;
    case 'password_reset':body='Reset your Primark Safety Passport password using the link below. Each link expires in 30 minutes and can be used once.';button='Reset password';path='/reset-password/#token=sample-preview';break;
  }
  if(kind==='password_reset'){const link=origin+'/reset-password/?lang=en#token=sample-preview';return {Subject:subject,TextBody:body+'\n\n'+link,HtmlBody:passwordResetHtml('en',['Learning account: '+link])};}
  if(kind==='invitation'||kind==='invitation_reminder')path='/accept-invitation/#token='+encodeURIComponent(invitationToken||'sample-preview');
  // Only our configured origin and application-relative links are permitted.
  if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid email link');
  const link=new URL(path,origin).href;
  const footer=kind==='invitation'||kind==='invitation_reminder'?'This invitation link is valid for 7 days. Contact your manager if you need a new invitation.':'This is a training notification from Primark Safety Passport. For help with your training, contact your manager.';
  const report=p.report;
  const lines=report?`As of ${new Intl.DateTimeFormat('en-GB',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/London'}).format(new Date(report.generatedAt))} (London time). Current snapshot.
Compliance: ${report.compliance===null?'Not applicable':report.compliance+'%'}. ${report.compliant} compliant / ${report.assessed} assessed assignments. ${report.withinDeadline} within deadline.
${report.overdue} overdue assignments; ${report.expired} expired certificates; ${report.expiring} certificates expiring within 30 days; ${report.assessment} assignments awaiting practical assessment.
`+(kind==='manager_digest'?(report.rows.length?'Overdue learners (up to 50, oldest first):\n'+report.rows.map(r=>`${r.name} — ${r.course} — due ${new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'Europe/London'}).format(new Date(r.due))}`).join('\n'):'No overdue learners.'):''):'';
  if(report)subject=`${emailLabels[kind as EmailKind]} — ${p.store||'Training'}`;
  if(report)body=`${p.store||'Your training'} — ${emailLabels[kind as EmailKind]}.`;
  const TextBody=`PRIMARK · Safety Passport\n\nHello ${p.name},\n\n${body}\n\n${lines}\n\n${button}: ${link}\n\n${footer}`;
  const HtmlBody=brandedEmail(subject,body+(lines?'\n\n'+lines:''),[{url:link,label:button}],footer,`Hello ${p.name},`,'en');
  return {Subject:subject,TextBody,HtmlBody};
}

function brandedEmail(subject:string,body:string,links:{url:string;label:string}[],footer:string,greeting:string,language:Language){return `<!doctype html><html lang="${language}" dir="${languageDirection(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f6f8;font-family:Arial,sans-serif;color:#172d3c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px"><table role="presentation" width="600" style="max-width:100%;background:white;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 32px;background:#00a7ce;border-radius:16px 16px 0 0;color:white"><strong style="font-size:28px;letter-spacing:2px">PRIMARK</strong><div style="margin-top:8px">Safety Passport</div></td></tr><tr><td style="padding:32px"><h1 style="font-size:24px;line-height:1.3;margin-top:0">${escape(subject)}</h1>${greeting?`<p>${escape(greeting)}</p>`:""}<p style="font-size:16px;line-height:1.6;white-space:pre-line">${escape(body)}</p>${links.map(item=>`<p style="margin:28px 0"><a href="${escape(item.url)}" style="display:inline-block;background:#007f9e;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escape(item.label)}</a></p>`).join('')}<p style="font-size:13px;line-height:1.5;color:#536676">${escape(footer)}</p></td></tr></table></td></tr></table></body></html>`;}
export function passwordResetHtml(language:Language,links:string[]){
 return brandedEmail(tr(language,'Reset your Primark password'),tr(language,'Reset your Primark Safety Passport password using the link below. Each link expires in 30 minutes and can be used once.'),links.map(value=>{const index=value.indexOf('https://');return {label:value.slice(0,index).replace(/:\s*$/,'')||tr(language,'Reset password'),url:value.slice(index)};}),tr(language,'If you did not request this, you can ignore this email. Your password has not changed.'),'',language);
}
