import { createHash, randomBytes } from 'node:crypto';
import { db, inTransaction } from '@/lib/database';
import { credentialFingerprint, credentials, sessionCredentialFingerprint } from '@/lib/admin-auth';
import { hashPassword, validPassword } from '@/lib/learner-auth';
import { tr } from '@/lib/ui-copy';
import { isLanguage, type Language } from '@/lib/i18n';
import { runtimeEnv } from '@/lib/runtime-env';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const learnerFingerprint = (row: {password_hash: unknown; code_hash: unknown}) => digest(JSON.stringify([row.password_hash, row.code_hash]));
const invalidLink = 'This reset link has expired or has already been used. Request a new one.';
export class RecoveryError extends Error {}

function mailSettings() {
  const token = runtimeEnv('POSTMARK_SERVER_TOKEN'), from = runtimeEnv('POSTMARK_FROM_EMAIL');
  // Never derive an emailed reset URL from a request Host or forwarded header.
  let origin: URL;
  try { origin = new URL(runtimeEnv('PRIMARK_APP_URL')); }
  catch { throw new RecoveryError('Password recovery is not available yet. Please contact your administrator.'); }
  if (!token || !from || origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new RecoveryError('Password recovery is not available yet. Please contact your administrator.');
  }
  return {token, from, origin: origin.origin};
}

export async function requestPasswordReset(email: string, requestedLanguage: Language = 'en') {
  const lang = isLanguage(requestedLanguage) ? requestedLanguage : 'en';
  const settings = mailSettings();
  const learner = await db().prepare(`SELECT id,password_hash,code_hash,
    EXISTS(SELECT 1 FROM platform_admins p WHERE p.learner_id=learners.id) AS platform_admin
    FROM learners WHERE email=?`).bind(email)
    .first<{id:string; password_hash:string|null; code_hash:string; platform_admin:boolean}>();
  const accounts: {type:string; id:string; fingerprint:string; label:string}[] = [];
  if (email === credentials()?.email) accounts.push({type:'admin',id:email,fingerprint:await sessionCredentialFingerprint(),label:'Platform admin'});
  if (learner) accounts.push({type:'learner',id:learner.id,fingerprint:learnerFingerprint(learner),label:learner.platform_admin ? 'Platform admin' : 'Learning account'});
  await db().prepare('DELETE FROM password_resets WHERE expires_at<NOW()').run();
  if (!accounts.length) return;
  const links: string[] = [], tokenHashes: string[] = [];
  const expires = new Date(Date.now() + 30 * 60000).toISOString();
  for (const account of accounts) {
    const token = randomBytes(32).toString('hex'), tokenHash = digest(token);
    await db().prepare('INSERT INTO password_resets(token_hash,account_type,account_id,credential_hash,expires_at) VALUES(?,?,?,?,?)')
      .bind(tokenHash,account.type,account.id,account.fingerprint,expires).run();
    tokenHashes.push(tokenHash);
    // The fragment keeps reset tokens out of server access logs and referrers.
    links.push(`${tr(lang,account.label)}: ${settings.origin}/reset-password/?lang=${lang}#token=${token}`);
  }
  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method:'POST', signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json','Accept':'application/json','X-Postmark-Server-Token':settings.token},
      body:JSON.stringify({From:settings.from,To:email,Subject:tr(lang,'Reset your Primark password'),
        TextBody:`${tr(lang,'Reset your Primark Safety Passport password using the link below. Each link expires in 30 minutes and can be used once.')}\n\n${links.join('\n\n')}\n\n${tr(lang,'If you did not request this, you can ignore this email. Your password has not changed.')}`,
        MessageStream:runtimeEnv('POSTMARK_MESSAGE_STREAM') || 'outbound',TrackOpens:false,TrackLinks:'None'}),
    });
    const result = await response.json();
    if (!response.ok || result.ErrorCode !== 0) throw new Error('Delivery failed');
  } catch {
    await db().batch(tokenHashes.map(token => db().prepare('DELETE FROM password_resets WHERE token_hash=?').bind(token)));
    // Do not expose whether an address exists, delivery responses, or secret links.
    console.error('Primark password recovery email could not be delivered. Check the sender configuration.');
  }
}

export async function resetPassword(token: unknown, password: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new RecoveryError(invalidLink);
  if (!validPassword(password)) throw new RecoveryError('Create a password with 8–128 characters.');
  // Do the expensive hash outside the transaction, after basic validation.
  const passwordHash = await hashPassword(password);
  await inTransaction(async client => {
    const reset = (await client.query('SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at>NOW() FOR UPDATE',[digest(token)])).rows[0];
    if (!reset) throw new RecoveryError(invalidLink);
    if (reset.account_type === 'learner') {
      const row = (await client.query('SELECT password_hash,code_hash FROM learners WHERE id=$1 FOR UPDATE',[reset.account_id])).rows[0];
      if (!row || learnerFingerprint({password_hash:row.password_hash,code_hash:row.code_hash}) !== reset.credential_hash) throw new RecoveryError(invalidLink);
      await client.query('UPDATE learners SET password_hash=$1,code_hash=$2 WHERE id=$3',[passwordHash,digest(randomBytes(32).toString('hex')),reset.account_id]);
      await client.query('DELETE FROM sessions WHERE learner_id=$1',[reset.account_id]);
    } else {
      if (credentials()?.email !== reset.account_id) throw new RecoveryError(invalidLink);
      if (password.length < 16) throw new RecoveryError('Create a platform admin password with 16–128 characters.');
      const bootstrap = credentialFingerprint();
      const row = (await client.query('SELECT * FROM admin_passwords WHERE email=$1 FOR UPDATE',[reset.account_id])).rows[0];
      const fingerprint = row?.bootstrap_hash === bootstrap ? digest(bootstrap + ':' + row.password_hash) : bootstrap;
      if (fingerprint !== reset.credential_hash) throw new RecoveryError(invalidLink);
      if (row) await client.query('UPDATE admin_passwords SET bootstrap_hash=$1,password_hash=$2 WHERE email=$3',[bootstrap,passwordHash,reset.account_id]);
      else {
        const inserted = await client.query('INSERT INTO admin_passwords(email,bootstrap_hash,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',[reset.account_id,bootstrap,passwordHash]);
        if (!inserted.rowCount) throw new RecoveryError(invalidLink);
      }
      await client.query('DELETE FROM admin_sessions WHERE email=$1',[reset.account_id]);
    }
    await client.query('DELETE FROM password_resets WHERE token_hash=$1',[digest(token)]);
  });
}
