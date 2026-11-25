import type { OutboxItem, OutboxStore } from '@credit-ledger/shared';

/** Browser fallback used for the web preview build (same interface as storage.ts). */
const PREFIX = 'cl:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return read<T>(`kv:${key}`);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  write(`kv:${key}`, value);
}

export async function clearCache(): Promise<void> {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(`${PREFIX}kv:`) && k !== `${PREFIX}kv:server_url`) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export const outboxStore: OutboxStore = {
  async all() {
    const items = read<Record<string, OutboxItem>>('outbox') ?? {};
    return Object.values(items).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async put(item) {
    const items = read<Record<string, OutboxItem>>('outbox') ?? {};
    items[item.client_ref] = item;
    write('outbox', items);
  },
  async remove(clientRef) {
    const items = read<Record<string, OutboxItem>>('outbox') ?? {};
    delete items[clientRef];
    write('outbox', items);
  },
};
