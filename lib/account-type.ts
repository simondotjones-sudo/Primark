import { db } from '@/lib/database';

// Account type follows the current grants. Existing accounts change immediately,
// without rewriting or deleting their historical learning records.
export function learnerOnlySql(alias = 'l') {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Invalid account alias');
  return `NOT EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.learner_id=${alias}.id)
    AND NOT EXISTS(SELECT 1 FROM reporting_access ra WHERE ra.learner_id=${alias}.id)
    AND NOT EXISTS(SELECT 1 FROM store_managers sm WHERE sm.learner_id=${alias}.id)`;
}
export async function isAdminOnly(id: string) {
  const row = await db().prepare(`SELECT NOT (${learnerOnlySql()}) AS admin_only FROM learners l WHERE l.id=?`)
    .bind(id).first<{admin_only: boolean}>();
  return !!row?.admin_only;
}

export function activeLearnerSql(alias='l') {
  return `${alias}.archived_at IS NULL AND (${learnerOnlySql(alias)})`;
}
export async function canLearn(id:string) {
  return !!await db().prepare(`SELECT l.id FROM learners l WHERE l.id=? AND ${activeLearnerSql()}`).bind(id).first();
}
