import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** API keys for the Tally sync agent: shown once, stored only as a SHA-256 hash. */
export function newAgentKey(): { key: string; hash: string } {
  const key = `clk_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashAgentKey(key) };
}

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
