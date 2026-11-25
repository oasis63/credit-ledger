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

  it('makes offline collections idempotent and keeps the collection date', async () => {
    const ref = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
    const before = sender.sent.length;
    const body = { customer_id: customerId, amount: '1200', payment_mode: 'cash', client_ref: ref, collected_on: '2026-11-23' };
    const first = await call('POST', '/api/collections', salesmanToken, body);
    expect(first.status).toBe(201);
    expect(first.body.entry.entry_date).toBe('2026-11-23');
    // Retry after a dropped connection: same entry back, no second receipt, no double payment.
    const retry = await call('POST', '/api/collections', salesmanToken, body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.entry.id).toBe(first.body.entry.id);
    expect(sender.sent.length).toBe(before + 1);
    const misuse = await call('POST', '/api/collections', salesmanToken, { ...body, amount: '999' });
    expect(misuse.status).toBe(409);
    const tooOld = await call('POST', '/api/collections', salesmanToken, { ...body, client_ref: undefined, collected_on: '2026-11-01' });
    expect(tooOld.status).toBe(400);
    const future = await call('POST', '/api/collections', salesmanToken, { ...body, client_ref: undefined, collected_on: '2026-11-30' });
    expect(future.status).toBe(400);
  });

  it('stores contact, area, tags; lists facets; guards archiving', async () => {
    const upd = await call('PATCH', `/api/customers/${customerId}`, ownerToken, {
      contact_name: 'Ramesh Gupta', area: 'Karol Bagh', tags: ['Pharmacy', 'priority'], address: '12 Main Rd',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.customer).toMatchObject({ contact_name: 'Ramesh Gupta', area: 'Karol Bagh', tags: ['pharmacy', 'priority'] });
    const created = await call('POST', '/api/customers', ownerToken, { name: 'New Shop', phone: '9811100001', area: 'Lajpat Nagar', contact_name: 'Anil' });
    expect(created.body.customer).toMatchObject({ area: 'Lajpat Nagar', contact_name: 'Anil' });
    const facets = await call('GET', '/api/customers/facets', ownerToken);
    expect(facets.body.areas.map((a: { area: string }) => a.area)).toEqual(['Karol Bagh', 'Lajpat Nagar']);
    expect((await call('GET', '/api/customers?tag=priority', ownerToken)).body.customers).toHaveLength(1);
    expect((await call('GET', '/api/customers?search=ramesh', ownerToken)).body.customers[0].id).toBe(customerId);
    // A customer who still owes money cannot be archived; a settled one can.
    expect((await call('PATCH', `/api/customers/${customerId}`, ownerToken, { archived: true })).status).toBe(400);
    const arch = await call('PATCH', `/api/customers/${created.body.customer.id}`, ownerToken, { archived: true });
    expect(arch.body.customer.archived_at).toBeTruthy();
    expect((await call('GET', '/api/customers', ownerToken)).body.customers.some((c: { id: string }) => c.id === created.body.customer.id)).toBe(false);
    expect((await call('GET', '/api/customers?archived=1', ownerToken)).body.customers).toHaveLength(1);
  });

  it('imports customers from a spreadsheet with validation, dry run and opening balances', async () => {
    const rows = [
      { name: 'Verma Kirana', phone: '98111 22233', contact_name: 'Sunil', area: 'Rohini', credit_limit: '50,000', credit_days: '15', opening_balance: '₹12,500.50', tags: 'kirana; new' },
      { name: 'Bad Phone', phone: '12345' },
      { name: '', phone: '9811122234' },
      { name: 'Dup in file', phone: '9811122233' },
      { name: 'Gupta again', phone: '9876543210', area: 'Updated Area' },
      { name: 'Wrong GST', phone: '9811122235', gstin: 'ABC' },
    ];
    const dry = await call('POST', '/api/customers/import', ownerToken, { rows, dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dry_run: true, created: 1, skipped: 1, opening_balances: 1 });
    expect(dry.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 7]);
    expect((await call('GET', '/api/customers?search=verma', ownerToken)).body.customers).toHaveLength(0);

    const real = await call('POST', '/api/customers/import', ownerToken, { rows, opening_date: '2026-11-01' });
    expect(real.body).toMatchObject({ created: 1, skipped: 1, opening_balances: 1 });
    const verma = (await call('GET', '/api/customers?search=verma', ownerToken)).body.customers[0];
    expect(verma).toMatchObject({ phone: '919811122233', credit_limit_paise: 5_000_000, credit_days: 15, balance_paise: 1_250_050, tags: ['kirana', 'new'] });
    // Re-import with update: details change, balance is not doubled.
    const again = await call('POST', '/api/customers/import', ownerToken, { rows: [rows[0]!], on_duplicate: 'update' });
    expect(again.body).toMatchObject({ created: 0, updated: 1, opening_balances: 0 });
    expect((await call('GET', `/api/customers/${verma.id}`, ownerToken)).body.balance_paise).toBe(1_250_050);
    expect((await call('POST', '/api/customers/import', salesmanToken, { rows })).status).toBe(403);
  });

  let billId = '';
  it('creates GST bills with numbering, tax split, ledger posting, QR and cancellation', async () => {
    const st = await call('PATCH', '/api/settings', ownerToken, {
      gstin: '07AAACS1234A1Z5', address: 'Chandni Chowk, Delhi', bill_prefix: 'SPD/', next_bill_no: 101, upi_vpa: 'sharma@okhdfc', upi_payee_name: 'Sharma Pharma',
    });
    expect(st.status).toBe(200);
    expect(st.body.tenant.state_code).toBe('07');
    const before = (await call('GET', `/api/customers/${customerId}`, ownerToken)).body.balance_paise;
    const items = [
      { description: 'Paracetamol 500 (strip)', hsn: '3004', qty: 10, unit: 'strip', rate: '25.50', gst_rate: 12 },
      { description: 'Bandage roll', qty: 2.5, unit: 'box', rate: 100, discount_pct: 10, gst_rate: 5 },
    ];
    const preview = await call('POST', '/api/bills/preview', ownerToken, { customer_id: customerId, items });
    expect(preview.status).toBe(200);
    // 255.00 @12% -> CGST 15.30 + SGST 15.30; 250 - 10% = 225 @5% -> 5.63 + 5.63
    expect(preview.body).toMatchObject({ interstate: false, taxable_paise: 48_000, cgst_paise: 2_093, sgst_paise: 2_093, igst_paise: 0 });
    expect(preview.body.total_paise).toBe(52_200);
    expect(preview.body.round_off_paise).toBe(14);

    const res = await call('POST', '/api/bills', ownerToken, { customer_id: customerId, items, bill_date: '2026-11-25' });
    expect(res.status).toBe(201);
    expect(res.body.bill).toMatchObject({ bill_no: 'SPD/101', total_paise: 52_200 });
    billId = res.body.bill.id;
    const second = await call('POST', '/api/bills', ownerToken, { customer_id: customerId, items: [items[0]] });
    expect(second.body.bill.bill_no).toBe('SPD/102');
    const after = (await call('GET', `/api/customers/${customerId}`, ownerToken)).body;
    expect(after.balance_paise).toBe(before + 52_200 + second.body.bill.total_paise);
    expect(after.bills[0].bill_no).toBe('SPD/102');

    const full = await call('GET', `/api/bills/${billId}`, ownerToken);
    expect(full.body.bill.amount_in_words).toBe('Five Hundred Twenty Two Rupees Only');
    expect(full.body.items).toHaveLength(2);
    expect(full.body.items[1]).toMatchObject({ qty: 2.5, discount_pct: 10, gst_rate: 5, taxable_paise: 22_500 });
    expect(full.body.upi.link).toContain('am=522.00');
    expect(full.body.upi.qr_svg).toContain('<svg');
    expect(full.body.tax_summary).toEqual([
      { gst_rate: 5, taxable_paise: 22_500, tax_paise: 1_126 },
      { gst_rate: 12, taxable_paise: 25_500, tax_paise: 3_060 },
    ]);

    // Inter-state customer (GSTIN from another state) gets IGST.
    const ka = await call('POST', '/api/customers', ownerToken, { name: 'Bengaluru Pharma', phone: '9811100009', gstin: '29AAACB1234A1Z5' });
    const igst = await call('POST', '/api/bills/preview', ownerToken, { customer_id: ka.body.customer.id, items: [items[0]] });
    expect(igst.body).toMatchObject({ interstate: true, igst_paise: 3_060, cgst_paise: 0 });

    expect((await call('POST', '/api/bills', salesmanToken, { customer_id: customerId, items })).status).toBe(403);
    expect((await call('GET', `/api/bills/${billId}`, otherToken)).status).toBe(404);
    expect((await call('POST', '/api/bills/preview', ownerToken, { items: [{ ...items[0], gst_rate: 7 }] })).status).toBe(400);

    const cancel = await call('POST', `/api/bills/${billId}/cancel`, ownerToken, { reason: 'Wrong quantity' });
    expect(cancel.status).toBe(200);
    expect((await call('POST', `/api/bills/${billId}/cancel`, ownerToken, { reason: 'again' })).status).toBe(409);
    const afterCancel = (await call('GET', `/api/customers/${customerId}`, ownerToken)).body.balance_paise;
    expect(afterCancel).toBe(after.balance_paise - 52_200);
    await expect(db.query("UPDATE bills SET total_paise = 1 WHERE bill_no = 'SPD/102'")).rejects.toThrow(/immutable/);
    const qr = await call('GET', `/api/customers/${customerId}/upi-qr`, ownerToken);
    expect(qr.body.amount_paise).toBe(afterCancel);
    expect(qr.body.svg).toContain('<svg');
  });

  it('plans beats, shows today\'s route, records visits and pins shops', async () => {
    const beat = await call('POST', '/api/beats', ownerToken, { name: 'Karol Bagh Wed', salesman_id: salesmanId, weekdays: [3, 6] });
    expect(beat.status).toBe(201);
    const verma = (await call('GET', '/api/customers?search=verma', ownerToken)).body.customers[0];
    expect((await call('PUT', `/api/beats/${beat.body.beat.id}/customers`, ownerToken, { customer_ids: [verma.id, customerId] })).status).toBe(200);
    expect((await call('PATCH', `/api/settings/users/${salesmanId}`, ownerToken, { daily_target: '20000' })).body.user.daily_target_paise).toBe(2_000_000);

    // 2026-11-25 is a Wednesday (weekday 3).
    const route = await call('GET', '/api/field/today', salesmanToken);
    expect(route.status).toBe(200);
    expect(route.body.beats).toEqual([{ id: beat.body.beat.id, name: 'Karol Bagh Wed' }]);
    expect(route.body.stops.map((s: { id: string }) => s.id)).toEqual([verma.id, customerId]);
    expect(route.body.target_paise).toBe(2_000_000);
    expect(route.body.collected_paise).toBeGreaterThan(0);

    const ref = '0d4a9a39-7f1c-4a21-9c49-3a9b0f7e1a10';
    const visit = { customer_id: verma.id, outcome: 'promised', note: 'Will pay Friday', lat: 28.6519, lng: 77.1909, accuracy_m: 15, client_ref: ref };
    expect((await call('POST', '/api/visits', salesmanToken, visit)).status).toBe(201);
    const dup = await call('POST', '/api/visits', salesmanToken, visit);
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);
    const shop = (await call('GET', `/api/customers/${verma.id}`, ownerToken)).body;
    expect(shop.customer).toMatchObject({ lat: 28.6519, lng: 77.1909 });
    expect(shop.visits[0]).toMatchObject({ outcome: 'promised' });
    expect(shop.beat.name).toBe('Karol Bagh Wed');
    // A poor GPS fix never moves an already pinned shop.
    await call('POST', '/api/visits', salesmanToken, { ...visit, client_ref: undefined, lat: 1, lng: 1, accuracy_m: 900, pin_shop: true });
    expect((await call('GET', `/api/customers/${verma.id}`, ownerToken)).body.customer.lat).toBe(28.6519);

    const after = await call('GET', '/api/field/today', salesmanToken);
    expect(after.body.visited).toBe(1);
    expect(after.body.stops[0].visit.outcome).toBe('promised');
    // Thursday: no beat scheduled.
    expect((await call('GET', '/api/field/today?date=2026-11-26', salesmanToken)).body.stops).toEqual([]);
    expect((await call('GET', `/api/field/today?salesman_id=${salesmanId}`, ownerToken)).body.salesman.id).toBe(salesmanId);
    expect((await call('GET', '/api/beats', ownerToken)).body.beats[0]).toMatchObject({ customer_count: 2, salesman_id: salesmanId });
    expect((await call('GET', '/api/visits', salesmanToken)).body.visits).toHaveLength(2);
    expect((await call('POST', '/api/beats', salesmanToken, { name: 'x' })).status).toBe(403);
  });

  it('reports trends, salesman performance, GST and aging', async () => {
    const trend = await call('GET', '/api/reports/trend?from=2026-11-01&to=2026-11-25', ownerToken);
    expect(trend.status).toBe(200);
    expect(trend.body.days).toHaveLength(25);
    expect(trend.body.collected_paise).toBe(trend.body.days.reduce((s: number, d: { collected_paise: number }) => s + d.collected_paise, 0));
    expect(trend.body.by_mode.length).toBeGreaterThan(0);
    const sm = await call('GET', '/api/reports/salesmen?from=2026-11-19&to=2026-11-25', ownerToken);
    const me = sm.body.salesmen.find((s: { id: string }) => s.id === salesmanId);
    expect(me).toMatchObject({ visits: 2, outcomes: { promised: 2 } });
    expect(me.target_paise).toBe(2_000_000 * me.work_days);
    const gst = await call('GET', '/api/reports/gst?from=2026-11-01&to=2026-11-30', ownerToken);
    expect(gst.body.totals).toMatchObject({ bills: 1, cancelled: 1 });
    expect(gst.body.by_rate).toEqual([{ gst_rate: 12, taxable_paise: 25_500, tax_paise: 3_060 }]);
    const aging = await call('GET', '/api/reports/aging', ownerToken);
    expect(aging.body.customers.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/reports/trend?from=2026-12-01&to=2026-11-01', ownerToken)).status).toBe(400);
    expect((await call('GET', '/api/reports/gst', salesmanToken)).status).toBe(403);
  });

  it('reports health', async () => {
    expect((await call('GET', '/healthz')).body).toEqual({ ok: true });
  });
});
