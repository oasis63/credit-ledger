import * as SQLite from 'expo-sqlite';
import type { OutboxItem, OutboxStore } from '@credit-ledger/shared';

/**
 * On-device storage (SQLite). Holds two things:
 *  - kv: cached API responses so customers and ledgers can be browsed offline
 *  - outbox: collections recorded offline, waiting to sync
 * The web build uses storage.web.ts instead (Metro picks it by extension).
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('credit-ledger.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (
          client_ref TEXT PRIMARY KEY NOT NULL,
          created_at TEXT NOT NULL,
          item TEXT NOT NULL
        );
      `);
      return d;
    })();
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).runAsync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

/** Remove everything except the outbox (unsynced money must never be lost on logout). */
export async function clearCache(): Promise<void> {
  await (await db()).runAsync("DELETE FROM kv WHERE key != 'server_url'");
}

export const outboxStore: OutboxStore = {
  async all() {
    const rows = await (await db()).getAllAsync<{ item: string }>('SELECT item FROM outbox ORDER BY created_at');
    return rows.map((r) => JSON.parse(r.item) as OutboxItem);
  },
  async put(item) {
    await (await db()).runAsync(
      'INSERT INTO outbox (client_ref, created_at, item) VALUES (?, ?, ?) ON CONFLICT(client_ref) DO UPDATE SET item = excluded.item',
      item.client_ref,
      item.created_at,
      JSON.stringify(item),
    );
  },
  async remove(clientRef) {
    await (await db()).runAsync('DELETE FROM outbox WHERE client_ref = ?', clientRef);
  },
};
