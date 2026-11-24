import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { ConsoleSender } from '../src/services/whatsapp.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run('API (integration, real Postgres)', () => {
  let app: FastifyInstance;
  let db: Db;
  const sender = new ConsoleSender();
  const fixedNow = new Date('2026-11-25T06:00:00Z');
  const appSecret = 'meta-app-secret';

  let ownerToken = '';
  let otherToken = '';
  let salesmanToken = '';
  let salesmanId = '';
  let customerId = '';
  let invoiceId = '';

  const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      payload: payload as object,
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };

  beforeAll(async () => {
    db = createPool(DATABASE_URL!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db, () => undefined);
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: DATABASE_URL!,
      JWT_SECRET: 'j'.repeat(40),
      STATEMENT_LINK_SECRET: 's'.repeat(40),
      PUBLIC_WEB_URL: 'https://app.example.in',
      WHATSAPP_APP_SECRET: appSecret,
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
    });
    app = await buildApp({ config, db, sender, now: () => fixedNow });
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('registers businesses and logs in', async () => {
    const r1 = await call('POST', '/api/auth/register', undefined, {
      businessName: 'Sharma Pharma Distributors',
      name: 'Ravi Sharma',
      email: 'ravi@example.in',
      password: 'a-long-password',
    });
    expect(r1.status).toBe(201);
    ownerToken = r1.body.token;

    const r2 = await call('POST', '/api/auth/register', undefined, {
      businessName: 'Other Distributor',
      name: 'Other Owner',
      email: 'other@example.in',
      password: 'a-long-password',
    });
    otherToken = r2.body.token;

    const dup = await call('POST', '/api/auth/register', undefined, {
      businessName: 'Dup', name: 'Dup', email: 'ravi@example.in', password: 'a-long-password',
    });
    expect(dup.status).toBe(409);

    const bad = await call('POST', '/api/auth/login', undefined, { email: 'ravi@example.in', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const good = await call('POST', '/api/auth/login', undefined, { email: 'RAVI@example.in', password: 'a-long-password' });
    expect(good.status).toBe(200);
    expect(good.body.user.role).toBe('owner');
  });

  it('rejects unauthenticated and invalid requests', async () => {
    expect((await call('GET', '/api/customers')).status).toBe(401);
    const v = await call('POST', '/api/customers', ownerToken, { name: '', phone: '123' });
    expect(v.status).toBe(400);
    expect(v.body.error).toBe('validation_error');
  });

  it('configures UPI and adds staff', async () => {
    const s = await call('PATCH', '/api/settings', ownerToken, { upi_vpa: 'sharmapharma@okhdfcbank', wa_phone_number_id: '1234567890' });
    expect(s.status).toBe(200);
    const u = await call('POST', '/api/settings/users', ownerToken, {
      name: 'Suresh', email: 'suresh@example.in', role: 'salesman', password: 'salesman-pass-1',
    });
    expect(u.status).toBe(201);
    salesmanId = u.body.user.id;
    const login = await call('POST', '/api/auth/login', undefined, { email: 'suresh@example.in', password: 'salesman-pass-1' });
    salesmanToken = login.body.token;
  });

  it('creates customers and posts ledger entries', async () => {
    const c = await call('POST', '/api/customers', ownerToken, {
      name: 'Gupta Medical Store', phone: '98765 43210', credit_limit: '50000', credit_days: 30, language: 'hi',
    });
    expect(c.status).toBe(201);
    expect(c.body.customer.phone).toBe('919876543210');
    customerId = c.body.customer.id;

    const inv1 = await call('POST', `/api/customers/${customerId}/entries`, ownerToken, {
      kind: 'invoice', amount: '40000', entry_date: '2026-09-01', reference: 'INV-101',
    });
    expect(inv1.status).toBe(201);
    expect(inv1.body.entry.due_date).toBe('2026-10-01');
    invoiceId = inv1.body.entry.id;

    await call('POST', `/api/customers/${customerId}/entries`, ownerToken, {
      kind: 'invoice', amount: 25000, entry_date: '2026-11-10', reference: 'INV-140',
    });
    const pay = await call('POST', `/api/customers/${customerId}/entries`, ownerToken, {
      kind: 'payment', amount: '10000', entry_date: '2026-10-15', payment_mode: 'bank', payment_ref: 'UTR123',
    });
    expect(pay.status).toBe(201);

    const noMode = await call('POST', `/api/customers/${customerId}/entries`, ownerToken, { kind: 'payment', amount: 5 });
    expect(noMode.status).toBe(400);

    const detail = await call('GET', `/api/customers/${customerId}`, ownerToken);
    expect(detail.status).toBe(200);
    expect(detail.body.balance_paise).toBe(5_500_000);
    // 30000 of INV-101 is 55 days overdue; INV-140 not yet due.
    expect(detail.body.aging).toEqual({ not_due: 2_500_000, d1_30: 0, d31_60: 3_000_000, d61_90: 0, d90_plus: 0 });
    // 55 days overdue + more than half overdue + above the ₹50,000 credit limit.
    expect(detail.body.risk.flag).toBe('red');
    expect(detail.body.risk.reasons).toContain('Balance is above the credit limit');
    expect(detail.body.statement).toHaveLength(3);
  });

  it('enforces roles: salesmen cannot post invoices', async () => {
    const r = await call('POST', `/api/customers/${customerId}/entries`, salesmanToken, { kind: 'invoice', amount: 100 });
    expect(r.status).toBe(403);
  });

  it('isolates tenants with row-level security', async () => {
    const r = await call('GET', `/api/customers/${customerId}`, otherToken);
    expect(r.status).toBe(404);
    const list = await call('GET', '/api/customers', otherToken);
    expect(list.body.customers).toEqual([]);
    // Even a raw query as app_user with the other tenant id sees nothing.
    const other = await db.query("SELECT id FROM tenants WHERE name = 'Other Distributor'");
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [other.rows[0].id]);
      const leaked = await client.query('SELECT * FROM ledger_entries');
      expect(leaked.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('keeps the ledger immutable', async () => {
    await expect(db.query('UPDATE ledger_entries SET amount_paise = 1 WHERE id = $1', [invoiceId])).rejects.toThrow(/immutable/);
    await expect(db.query('DELETE FROM ledger_entries WHERE id = $1', [invoiceId])).rejects.toThrow(/immutable/);
  });

  it('records a field collection with an instant receipt, then closes the day', async () => {
    const before = sender.sent.length;
    const r = await call('POST', '/api/collections', salesmanToken, { customer_id: customerId, amount: '5000', payment_mode: 'cash' });
    expect(r.status).toBe(201);
    expect(r.body.receipt.sent).toBe(true);
    expect(sender.sent.length).toBe(before + 1);
    expect(sender.sent.at(-1)).toMatchObject({ to: '919876543210', amountText: '₹5,000', collectedBy: 'Suresh' });

    const chequeNoRef = await call('POST', '/api/collections', salesmanToken, { customer_id: customerId, amount: 100, payment_mode: 'cheque' });
    expect(chequeNoRef.status).toBe(400);

    const pending = await call('GET', '/api/collections/pending', ownerToken);
    expect(pending.body.pending[0]).toMatchObject({ salesman_id: salesmanId, cash_paise: 500_000 });

    const close = await call('POST', '/api/collections/day-close', ownerToken, { salesman_id: salesmanId, declared: '4500' });
    expect(close.status).toBe(201);
    expect(close.body.day_close.variance_paise).toBe(-50_000);

    const again = await call('POST', '/api/collections/day-close', ownerToken, { salesman_id: salesmanId, declared: 0 });
    expect(again.status).toBe(400);
  });

  it('serves the retailer statement via signed link and accepts disputes', async () => {
    const link = await call('POST', `/api/customers/${customerId}/statement-link`, ownerToken);
    expect(link.body.url).toMatch(/^https:\/\/app\.example\.in\/s\//);
    const token = link.body.url.split('/s/')[1];

    const s = await call('GET', `/api/public/statement/${token}`);
    expect(s.status).toBe(200);
    expect(s.body.customer_name).toBe('Gupta Medical Store');
    expect(s.body.balance_paise).toBe(5_000_000);
    expect(s.body.upi_link).toContain('pa=sharmapharma%40okhdfcbank');
    expect(s.body.upi_link).toContain('am=25000.00');

    const d = await call('POST', `/api/public/statement/${token}/disputes`, undefined, {
      entry_id: invoiceId, reason: 'return_not_applied', message: '5 boxes returned on 12 Sep',
    });
    expect(d.status).toBe(201);

    const tampered = await call('GET', `/api/public/statement/${token.slice(0, -2)}xx`);
    expect(tampered.status).toBe(404);

    const queue = await call('GET', '/api/disputes', ownerToken);
    expect(queue.body.disputes).toHaveLength(1);
    expect(queue.body.disputes[0].entry_reference).toBe('INV-101');
    const resolved = await call('POST', `/api/disputes/${queue.body.disputes[0].id}/resolve`, ownerToken, {
      status: 'resolved', resolution_note: 'Credit note CN-12 issued',
    });
    expect(resolved.status).toBe(200);
  });

  it('sends reminders with cooldown', async () => {
    const one = await call('POST', `/api/reminders/customers/${customerId}`, ownerToken);
    expect(one.status).toBe(201);
    expect(one.body.reminder.amount_paise).toBe(2_500_000);
    const bulk = await call('POST', '/api/reminders/bulk', ownerToken, {});
    expect(bulk.body).toEqual({ sent: 0, failed: 0, skipped_recently_reminded: 1 });
  });

  it('turns WhatsApp replies into payment promises (signed webhooks only)', async () => {
    const payload = JSON.stringify({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890' }, messages: [{ from: '919876543210', id: 'wamid.1', type: 'text', text: { body: 'kal 10000 rs bhej dunga' } }] } }] }],
    });
    const unsigned = await call('POST', '/webhooks/whatsapp', undefined, JSON.parse(payload));
    expect(unsigned.status).toBe(401);
    const sig = 'sha256=' + createHmac('sha256', appSecret).update(payload).digest('hex');
    const res = await app.inject({
      method: 'POST', url: '/webhooks/whatsapp', payload,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    });
    expect(res.statusCode).toBe(200);
    const detail = await call('GET', `/api/customers/${customerId}`, ownerToken);
    expect(detail.body.promises[0]).toMatchObject({ promised_date: '2026-11-26', amount_paise: 1_000_000, status: 'pending' });

    const verify = await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42' });
    expect(verify.body).toBe('42');
  });

  it('shows the dashboard', async () => {
    const d = await call('GET', '/api/reports/dashboard', ownerToken);
    expect(d.status).toBe(200);
    expect(d.body.receivable_paise).toBe(5_000_000);
    expect(d.body.overdue_paise).toBe(2_500_000);
    expect(d.body.top_overdue[0].name).toBe('Gupta Medical Store');
    expect(d.body.promises_due).toHaveLength(1);
    expect((await call('GET', '/api/reports/dashboard', salesmanToken)).status).toBe(403);
  });

  it('syncs Tally ledgers with an agent key', async () => {
    const k = await call('POST', '/api/settings/agent-keys', ownerToken, { label: 'Office PC' });
    expect(k.status).toBe(201);
    const sync = await call('POST', '/api/agent/sync/ledgers', k.body.key, {
      ledgers: [
        { name: 'Gupta Medical Store', phone: '9876543210', closing_balance_paise: 5_000_000 },
        { name: 'New Chemist', phone: '9123456789', closing_balance_paise: 120_000 },
        { name: 'No Phone Traders', closing_balance_paise: 1000 },
      ],
    });
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ updated: 1, created: 1, skipped: 1 });
    expect((await call('POST', '/api/agent/sync/ledgers', 'clk_wrong', { ledgers: [] })).status).toBe(401);
    const list = await call('GET', '/api/customers', ownerToken);
    expect(list.body.customers.find((c: { name: string }) => c.name === 'Gupta Medical Store').tally_balance_paise).toBe(5_000_000);
  });

  it('reports health', async () => {
    expect((await call('GET', '/healthz')).body).toEqual({ ok: true });
  });
});
