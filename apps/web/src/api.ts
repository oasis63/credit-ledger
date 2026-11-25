const BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'cl_token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && options.auth !== false) {
      setToken(null);
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }
    const issues = (data as { issues?: Array<{ path: string; message: string }> }).issues;
    const message = issues?.length
      ? issues.map((i) => `${i.path ? `${i.path}: ` : ''}${i.message}`).join('; ')
      : (data as { message?: string }).message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, issues);
  }
  return data as T;
}

// ---- Shared types (single source of truth in packages/shared) ----
export type { Role, User, RiskFlag, Risk, Aging, CustomerSummary, StatementLine } from '@credit-ledger/shared';
export interface Dispute {
  id: string; customer_id: string; customer_name?: string; entry_id: string | null; reason: string; message: string | null;
  raised_by: 'retailer' | 'staff'; status: 'open' | 'resolved' | 'rejected'; resolution_note: string | null; created_at: string;
  entry_reference?: string | null; entry_amount_paise?: number | null; entry_date?: string | null;
}
