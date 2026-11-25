/**
 * Default API address. Set EXPO_PUBLIC_API_URL at build time (see eas.json),
 * e.g. https://ledger.yourdomain.in. Users can override it on the sign-in
 * screen, which is handy for testing against a laptop on the same Wi-Fi.
 */
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

export function normaliseServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}
