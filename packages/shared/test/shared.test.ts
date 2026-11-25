import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, MemoryOutboxStore, Outbox, formatDate, timeAgo, formatRupees, paiseToRupeeString, parseRupees, todayInIndia, uuidv4, type NewCollection } from '../src/index';

describe('money', () => {
  it('parses what people type', () => {
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('₹ 800')).toBe(80000);
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('formats Indian style', () => {
    expect(formatRupees(123456789)).toBe('₹12,34,567.89');
    expect(formatRupees(-250000)).toBe('-₹2,500');
    expect(paiseToRupeeString(125050)).toBe('1250.50');
  });
  it('formats dates and knows India date', () => {
    expect(formatDate('2026-11-05')).toBe('5 Nov 2026');
    expect(formatDate('2026-11-05T10:00:00Z')).toBe('5 Nov 2026');
    expect(todayInIndia(new Date('2026-03-31T20:00:00Z'))).toBe('2026-04-01');
  });
  it('describes elapsed time', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(timeAgo('2026-11-25T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-25T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-11-25T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-23T12:00:00Z', now)).toBe('2 days ago');
  });
  it('makes valid v4 UUIDs', () => {
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

function fakeServer(script: Array<number | 'network'>) {
  const calls: unknown[] = [];
  const recorded = new Set<string>();
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as NewCollection;
    calls.push(body);
    const step = script.shift() ?? 201;
    if (step === 'network') throw new TypeError('Network request failed');
    if (step >= 400) return new Response(JSON.stringify({ error: 'x', message: `HTTP ${step}` }), { status: step });
    const duplicate = recorded.has(body.client_ref);
    recorded.add(body.client_ref);
    return new Response(
      JSON.stringify({ entry: { id: 'e', amount_paise: 1, entry_date: body.collected_on }, receipt: { number: 'R1', sent: true, error: null }, duplicate }),
      { status: duplicate ? 200 : 201 },
    );
  }) as unknown as typeof fetch;
  return { api: new ApiClient({ baseUrl: 'https://x', fetchImpl, getToken: () => 't' }), calls, recorded };
}

const collection = (ref: string): NewCollection => ({
  customer_id: 'c1',
  amount: '100.00',
  payment_mode: 'cash',
  client_ref: ref,
  collected_on: '2026-11-25',
});

describe('offline outbox', () => {
  it('syncs visits and collections in the order they happened, to the right endpoints', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      urls.push(url);
      const body = JSON.parse(init.body) as { client_ref: string; collected_on?: string };
      return url.endsWith('/api/visits')
        ? new Response(JSON.stringify({ visit: { id: 'v', outcome: 'promised' }, duplicate: false }), { status: 201 })
        : new Response(JSON.stringify({ entry: { id: 'e', amount_paise: 1, entry_date: body.collected_on }, receipt: { number: 'R9', sent: true, error: null }, duplicate: false }), { status: 201 });
    }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: 'https://x', fetchImpl, getToken: () => 't' });
    let t = 0;
    const outbox = new Outbox(new MemoryOutboxStore(), () => new Date(Date.UTC(2026, 10, 25, 10, 0, t++)));
    await outbox.addVisit({ customer_id: 'c1', outcome: 'promised', client_ref: 'v1', visited_on: '2026-11-25' }, 'Shop A');
    await outbox.add(collection('c2'), 'Shop B');
    expect(await outbox.sync(api)).toEqual({ synced: 2, failed: 0, remaining: 0, stoppedEarly: false });
    expect(urls).toEqual(['https://x/api/visits', 'https://x/api/collections']);
    const items = await outbox.list();
    expect(items.map((i) => [i.kind, i.receipt_no])).toEqual([['visit', null], ['collection', 'R9']]);
  });

  it('queues offline, stops at network errors, and syncs in order later', async () => {
    const outbox = new Outbox(new MemoryOutboxStore());
    await outbox.add(collection('a'), 'Shop A');
    await outbox.add(collection('b'), 'Shop B');
    const server = fakeServer(['network']);
    const r1 = await outbox.sync(server.api);
    expect(r1).toEqual({ synced: 0, failed: 0, remaining: 2, stoppedEarly: true });
    expect(server.calls).toHaveLength(1); // did not hammer a dead connection

    const r2 = await outbox.sync(server.api);
    expect(r2).toEqual({ synced: 2, failed: 0, remaining: 0, stoppedEarly: false });
    const items = await outbox.list();
    expect(items.map((i) => [i.client_ref, i.status, i.receipt_no])).toEqual([
      ['a', 'synced', 'R1'],
      ['b', 'synced', 'R1'],
    ]);
  });

  it('never double-records when a response is lost and the item is retried', async () => {
    const outbox = new Outbox(new MemoryOutboxStore());
    await outbox.add(collection('a'), 'Shop A');
    const server = fakeServer([]);
    // Server records it, but pretend the phone lost the response: mark pending again.
    await server.api.recordCollection(collection('a'));
    await outbox.sync(server.api);
    expect(server.recorded.size).toBe(1);
    expect((await outbox.list())[0]!.status).toBe('synced');
  });

  it('marks permanently rejected items as failed without blocking the queue', async () => {
    const outbox = new Outbox(new MemoryOutboxStore());
    await outbox.add(collection('bad'), 'Shop A');
    await outbox.add(collection('good'), 'Shop B');
    const server = fakeServer([400, 201]);
    const r = await outbox.sync(server.api);
    expect(r).toMatchObject({ synced: 1, failed: 1, remaining: 0 });
    const bad = (await outbox.list()).find((i) => i.client_ref === 'bad')!;
    expect(bad).toMatchObject({ status: 'failed', last_error: 'HTTP 400' });
    await outbox.retry('bad');
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('shares one sync run between concurrent callers', async () => {
    const outbox = new Outbox(new MemoryOutboxStore());
    await outbox.add(collection('a'), 'Shop A');
    const server = fakeServer([]);
    const [x, y] = await Promise.all([outbox.sync(server.api), outbox.sync(server.api)]);
    expect(x).toBe(y);
    expect(server.calls).toHaveLength(1);
  });

  it('prunes old synced items', async () => {
    let t = new Date('2026-11-01T00:00:00Z');
    const outbox = new Outbox(new MemoryOutboxStore(), () => t);
    await outbox.add(collection('a'), 'Shop A');
    await outbox.sync(fakeServer([]).api);
    t = new Date('2026-11-20T00:00:00Z');
    await outbox.prune(7);
    expect(await outbox.list()).toEqual([]);
  });

  it('classifies retryable errors', () => {
    expect(new ApiError(0, '', 'network').retryable).toBe(true);
    expect(new ApiError(503, '', 'x').retryable).toBe(true);
    expect(new ApiError(400, '', 'x').retryable).toBe(false);
  });
});
