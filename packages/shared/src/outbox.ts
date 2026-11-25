import { ApiError, type ApiClient } from './client';
import type { NewCollection, NewVisit } from './types';

/**
 * Offline outbox for field collections. Each collection is saved on the
 * device first, then synced. Because every item carries a client_ref, a sync
 * that is interrupted and retried can never record the same payment twice.
 */
export type OutboxStatus = 'pending' | 'synced' | 'failed';

export type OutboxItem = CollectionItem | VisitItem;

interface ItemBase {
  client_ref: string;
  customer_name: string;
  created_at: string; // ISO timestamp on the device
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  receipt_no: string | null;
  synced_at: string | null;
}

/** Items saved before visits existed have no `kind`; they are collections. */
export interface CollectionItem extends ItemBase {
  kind?: 'collection';
  payload: NewCollection;
}

export interface VisitItem extends ItemBase {
  kind: 'visit';
  payload: NewVisit;
}


/** Storage is injected so the same logic runs on SQLite (phone) and in memory (tests). */
export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(clientRef: string): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();
  async all() {
    return [...this.items.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async put(item: OutboxItem) {
    this.items.set(item.client_ref, { ...item });
  }
  async remove(clientRef: string) {
    this.items.delete(clientRef);
  }
}

export interface SyncReport {
  synced: number;
  failed: number;
  remaining: number;
  stoppedEarly: boolean;
}

export class Outbox {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private readonly store: OutboxStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Queue a shop visit (check-in). Synced in order with collections. */
  async addVisit(payload: NewVisit, customerName: string): Promise<OutboxItem> {
    const item: VisitItem = {
      kind: 'visit',
      client_ref: payload.client_ref,
      payload,
      customer_name: customerName,
      created_at: this.now().toISOString(),
      status: 'pending',
      attempts: 0,
      last_error: null,
      receipt_no: null,
      synced_at: null,
    };
    await this.store.put(item);
    return item;
  }

  async add(payload: NewCollection, customerName: string): Promise<OutboxItem> {
    const item: OutboxItem = {
      kind: 'collection',
      client_ref: payload.client_ref,
      payload,
      customer_name: customerName,
      created_at: this.now().toISOString(),
      status: 'pending',
      attempts: 0,
      last_error: null,
      receipt_no: null,
      synced_at: null,
    };
    await this.store.put(item);
    return item;
  }

  list(): Promise<OutboxItem[]> {
    return this.store.all();
  }

  async pendingCount(): Promise<number> {
    return (await this.store.all()).filter((i) => i.status === 'pending').length;
  }

  /** Retry a failed item (e.g. after the salesman fixes a cheque number on the web). */
  async retry(clientRef: string): Promise<void> {
    const item = (await this.store.all()).find((i) => i.client_ref === clientRef);
    if (item && item.status === 'failed') await this.store.put({ ...item, status: 'pending', last_error: null } as OutboxItem);
  }

  async discard(clientRef: string): Promise<void> {
    await this.store.remove(clientRef);
  }

  /** Drop synced items older than `days` to keep the device store small. */
  async prune(days = 7): Promise<void> {
    const cutoff = this.now().getTime() - days * 86_400_000;
    for (const i of await this.store.all()) {
      if (i.status === 'synced' && i.synced_at && Date.parse(i.synced_at) < cutoff) await this.store.remove(i.client_ref);
    }
  }

  /**
   * Send pending items in the order they were recorded. Stops at the first
   * network-type error (no point hammering a dead connection); marks items
   * the server rejects for good (validation, permission) as failed so they
   * don't block the queue. Concurrent calls share one run.
   */
  sync(api: ApiClient): Promise<SyncReport> {
    if (!this.running) {
      this.running = this.doSync(api).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async doSync(api: ApiClient): Promise<SyncReport> {
    let synced = 0;
    let failed = 0;
    let stoppedEarly = false;
    for (const item of await this.store.all()) {
      if (item.status !== 'pending') continue;
      try {
        let receipt: string | null = null;
        if (item.kind === 'visit') await api.recordVisit(item.payload);
        else receipt = (await api.recordCollection(item.payload)).receipt.number;
        await this.store.put({
          ...item,
          status: 'synced',
          attempts: item.attempts + 1,
          last_error: null,
          receipt_no: receipt,
          synced_at: this.now().toISOString(),
        } as OutboxItem);
        synced++;
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, (err as Error).message, 'unknown');
        if (e.retryable || e.status === 401) {
          await this.store.put({ ...item, attempts: item.attempts + 1, last_error: e.message } as OutboxItem);
          stoppedEarly = true;
          break;
        }
        await this.store.put({ ...item, status: 'failed', attempts: item.attempts + 1, last_error: e.message } as OutboxItem);
        failed++;
      }
    }
    return { synced, failed, remaining: await this.pendingCount(), stoppedEarly };
  }
}

/** RFC 4122 v4 UUID. Uses crypto.randomUUID / getRandomValues when available. */
export function uuidv4(random: () => number = Math.random): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
