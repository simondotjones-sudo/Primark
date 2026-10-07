import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}
const keyFor = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  deriveKey(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await keyFor(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split(':');
  const valid = parts?.length === 3 && parts[0] === 'scrypt-v1' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]);
  // Unknown accounts perform the same expensive operation as existing accounts.
  const key = await keyFor(password, valid ? parts[1] : '0'.repeat(32));
  return !!valid && timingSafeEqual(key, Buffer.from(parts[2], 'hex'));
}
