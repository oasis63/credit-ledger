import type { CollectionResult, CustomerDetail, CustomerSummary, NewCollection, User } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }

  /** True when retrying later may succeed (no network, timeout, server error, rate limit). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface ClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Typed client for the Credit Ledger API, usable from the browser and React Native. */
export class ApiClient {
  constructor(private readonly opts: ClientOptions) {}

  get baseUrl(): string {
    return this.opts.baseUrl.replace(/\/+$/, '');
  }

  async request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.auth !== false && this.opts.getToken) {
      const token = await this.opts.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      throw new ApiError(0, aborted ? 'The server took too long to respond' : 'No internet connection', aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) {
      if (res.status === 401 && init.auth !== false) this.opts.onUnauthorized?.();
      throw new ApiError(res.status, data.message ?? `Request failed (${res.status})`, data.error ?? 'error');
    }
    return data as T;
  }

  login(email: string, password: string) {
    return this.request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
  }

  me() {
    return this.request<{ user: User }>('/api/auth/me');
  }

  customers() {
    return this.request<{ customers: CustomerSummary[] }>('/api/customers');
  }

  customer(id: string) {
    return this.request<CustomerDetail>(`/api/customers/${encodeURIComponent(id)}`);
  }

  recordCollection(c: NewCollection) {
    return this.request<CollectionResult>('/api/collections', { method: 'POST', body: c });
  }

  statementLink(customerId: string) {
    return this.request<{ url: string; expires_in_days: number }>(`/api/customers/${encodeURIComponent(customerId)}/statement-link`, {
      method: 'POST',
    });
  }

  sendReminder(customerId: string) {
    return this.request<{ reminder: { status: string; error: string | null } }>(`/api/reminders/customers/${encodeURIComponent(customerId)}`, {
      method: 'POST',
    });
  }

  pendingHandover() {
    return this.request<{ pending: Array<{ salesman_id: string; salesman_name: string; entry_count: number; cash_paise: number; cheque_paise: number }> }>(
      '/api/collections/pending',
    );
  }
}
