import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import {
  ApiClient,
  ApiError,
  Outbox,
  todayInIndia,
  type CustomerDetail,
  type CustomerSummary,
  type FieldToday,
  type NewCollection,
  type NewVisit,
  type OutboxItem,
  type SyncReport,
  type User,
} from '@credit-ledger/shared';
import { DEFAULT_API_URL } from './config';
import { clearCache, kvGet, kvSet, outboxStore } from './storage';
import { tokenStore } from './secure';

interface Cached<T> {
  at: string;
  data: T;
}

export interface Loaded<T> {
  data: T;
  /** Set when the data came from the device cache because the network failed. */
  offlineSince: string | null;
}

interface SessionValue {
  ready: boolean;
  user: User | null;
  serverUrl: string;
  online: boolean;
  pendingCount: number;
  outboxItems: OutboxItem[];
  lastSync: { at: string; report: SyncReport } | null;
  signIn(serverUrl: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  loadCustomers(): Promise<Loaded<CustomerSummary[]>>;
  loadCustomer(id: string): Promise<Loaded<CustomerDetail>>;
  loadToday(): Promise<Loaded<FieldToday>>;
  recordCollection(input: Omit<NewCollection, 'client_ref' | 'collected_on'>, customerName: string): Promise<OutboxItem>;
  recordVisit(input: Omit<NewVisit, 'client_ref' | 'visited_on'>, customerName: string): Promise<OutboxItem>;
  syncNow(): Promise<SyncReport | null>;
  retryItem(clientRef: string): Promise<void>;
  discardItem(clientRef: string): Promise<void>;
  api: ApiClient;
}

const SessionContext = createContext<SessionValue | null>(null);
const SYNC_INTERVAL_MS = 2 * 60_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_API_URL);
  const [online, setOnline] = useState(true);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [lastSync, setLastSync] = useState<SessionValue['lastSync']>(null);
  const tokenRef = useRef<string | null>(null);
  const outbox = useMemo(() => new Outbox(outboxStore), []);

  const signOutRef = useRef<() => Promise<void>>(async () => undefined);
  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: serverUrl,
        getToken: () => tokenRef.current,
        onUnauthorized: () => void signOutRef.current(),
      }),
    [serverUrl],
  );

  const refreshOutbox = useCallback(async () => {
    setOutboxItems(await outbox.list());
  }, [outbox]);

  // Restore the session on launch. Works offline: the user stays signed in
  // with cached data, and the token is re-checked when the network returns.
  useEffect(() => {
    (async () => {
      const [url, token, cachedUser] = await Promise.all([kvGet<string>('server_url'), tokenStore.get(), kvGet<User>('user')]);
      if (url) setServerUrl(url);
      if (token && cachedUser) {
        tokenRef.current = token;
        setUser(cachedUser);
      }
      await outbox.prune(7);
      await refreshOutbox();
      setReady(true);
    })().catch(() => setReady(true));
  }, [outbox, refreshOutbox]);

  const syncNow = useCallback(async (): Promise<SyncReport | null> => {
    if (!tokenRef.current) return null;
    const report = await outbox.sync(api);
    setLastSync({ at: new Date().toISOString(), report });
    await refreshOutbox();
    return report;
  }, [api, outbox, refreshOutbox]);

  // Sync when the connection comes back, when the app returns to the foreground, and periodically.
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected !== false && state.isInternetReachable !== false;
      setOnline((was) => {
        if (!was && isOnline) void syncNow();
        return isOnline;
      });
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
    const timer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      unsubNet();
      appSub.remove();
      clearInterval(timer);
    };
  }, [syncNow]);

  const signIn = useCallback(async (url: string, email: string, password: string) => {
    const client = new ApiClient({ baseUrl: url });
    const res = await client.login(email.trim(), password);
    tokenRef.current = res.token;
    await tokenStore.set(res.token);
    await kvSet('server_url', url);
    await kvSet('user', res.user);
    setServerUrl(url);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    await tokenStore.clear();
    await clearCache();
    setUser(null);
  }, []);
  signOutRef.current = signOut;

  /** Fetch from the API; on network failure fall back to the last cached copy. */
  const loadWithCache = useCallback(async <T,>(key: string, fetcher: () => Promise<T>): Promise<Loaded<T>> => {
    try {
      const data = await fetcher();
      await kvSet(key, { at: new Date().toISOString(), data } satisfies Cached<T>);
      return { data, offlineSince: null };
    } catch (err) {
      if (err instanceof ApiError && err.retryable) {
        const cached = await kvGet<Cached<T>>(key);
        if (cached) return { data: cached.data, offlineSince: cached.at };
      }
      throw err;
    }
  }, []);

  const loadCustomers = useCallback(
    () => loadWithCache('customers', async () => (await api.customers()).customers),
    [api, loadWithCache],
  );
  const loadCustomer = useCallback((id: string) => loadWithCache(`customer:${id}`, () => api.customer(id)), [api, loadWithCache]);

  const loadToday = useCallback(() => loadWithCache('today', () => api.fieldToday()), [api, loadWithCache]);

  const recordVisit = useCallback<SessionValue['recordVisit']>(
    async (input, customerName) => {
      const item = await outbox.addVisit({ ...input, client_ref: Crypto.randomUUID(), visited_on: todayInIndia() }, customerName);
      await refreshOutbox();
      void syncNow();
      return item;
    },
    [outbox, refreshOutbox, syncNow],
  );

  const recordCollection = useCallback<SessionValue['recordCollection']>(
    async (input, customerName) => {
      const item = await outbox.add(
        { ...input, client_ref: Crypto.randomUUID(), collected_on: todayInIndia() },
        customerName,
      );
      await refreshOutbox();
      // Try to send right away; if offline it simply stays queued.
      void syncNow();
      return item;
    },
    [outbox, refreshOutbox, syncNow],
  );

  const retryItem = useCallback(
    async (ref: string) => {
      await outbox.retry(ref);
      await syncNow();
    },
    [outbox, syncNow],
  );

  const discardItem = useCallback(
    async (ref: string) => {
      await outbox.discard(ref);
      await refreshOutbox();
    },
    [outbox, refreshOutbox],
  );

  const value: SessionValue = {
    ready,
    user,
    serverUrl,
    online,
    pendingCount: outboxItems.filter((i) => i.status === 'pending').length,
    outboxItems,
    lastSync,
    signIn,
    signOut,
    loadCustomers,
    loadCustomer,
    loadToday,
    recordCollection,
    recordVisit,
    syncNow,
    retryItem,
    discardItem,
    api,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export function isStaff(user: User | null): boolean {
  return user?.role === 'owner' || user?.role === 'accountant';
}
