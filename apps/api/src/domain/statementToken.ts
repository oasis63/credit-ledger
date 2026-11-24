import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StatementClaims {
  tid: string; // tenant id
  cid: string; // customer id
  exp: number; // unix seconds
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

/**
 * Signed, expiring link token for a retailer's statement page. The retailer
 * needs no login: possession of the WhatsApp link is the credential, scoped to
 * one customer of one tenant, read plus dispute only.
 */
export function signStatementToken(claims: StatementClaims, secret: string): string {
  const body = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyStatementToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): StatementClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = createHmac('sha256', secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatementClaims;
    if (typeof claims.tid !== 'string' || typeof claims.cid !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp < nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}
