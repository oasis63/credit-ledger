/**
 * Demo data so you can try every screen: a distributor with 24 shops across
 * 3 beats, 2 salesmen, two months of bills and payments, visits, promises and
 * a dispute. Safe to run more than once (it does nothing if the demo account
 * exists).
 *
 *   npm run seed -w apps/api            (needs DATABASE_URL etc. like the API)
 *   make seed                           (inside Docker)
 *
 * Sign in with  demo@creditledger.in / demo-password-123
 */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, withTenant } from './db.js';
import { addDays, todayIso } from './domain/ledger.js';
import { migrate } from './migrate.js';
import { ConsoleSender } from './services/whatsapp.js';

const EMAIL = 'demo@creditledger.in';
const PASSWORD = 'demo-password-123';

// Deterministic pseudo-random numbers so every seed looks the same.
let state = 42;
const rnd = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;

const AREAS = [
  { area: 'Karol Bagh', lat: 28.6519, lng: 77.1909 },
  { area: 'Lajpat Nagar', lat: 28.5677, lng: 77.2433 },
  { area: 'Rohini Sec 7', lat: 28.7041, lng: 77.1025 },
];
const SHOPS = [
  'Sharma General Store', 'Gupta Medical Hall', 'Verma Kirana', 'New Bharat Traders', 'Agarwal Provision', 'Shiv Shakti Medicos',
  'Krishna Super Mart', 'Bansal Brothers', 'Jain Pharma Point', 'Om Sai Kirana', 'Raj Medical Store', 'Mahalaxmi Stores',
  'Goyal Enterprises', 'City Chemist', 'Hari Om Traders', 'Arora Daily Needs', 'Singh Medical', 'Balaji Kirana',
  'Kumar & Sons', 'Mittal General Store', 'Saini Pharmacy', 'Malhotra Mart', 'Anand Stores', 'Prakash Medicos',
];
const OWNERS = ['Ramesh', 'Suresh', 'Anil', 'Vijay', 'Rakesh', 'Manoj', 'Sanjay', 'Deepak', 'Ashok', 'Pankaj', 'Rajesh', 'Mukesh'];
const ITEMS = [
  { description: 'Paracetamol 500mg (strip of 10)', hsn: '3004', unit: 'strip', rate: '22.50', gst_rate: 12 },
  { description: 'ORS sachet (box of 25)', hsn: '3004', unit: 'box', rate: '310', gst_rate: 12 },
  { description: 'Hand sanitizer 500ml', hsn: '3808', unit: 'pcs', rate: '145', gst_rate: 18 },
  { description: 'Toor dal 1kg', hsn: '0713', unit: 'kg', rate: '138', gst_rate: 0 },
  { description: 'Basmati rice 5kg', hsn: '1006', unit: 'bag', rate: '520', gst_rate: 5 },
  { description: 'Detergent powder 1kg', hsn: '3402', unit: 'pcs', rate: '95', gst_rate: 18 },
  { description: 'Biscuits carton (48 pcs)', hsn: '1905', unit: 'case', rate: '480', gst_rate: 18 },
  { description: 'Mustard oil 1L', hsn: '1514', unit: 'ltr', rate: '165', gst_rate: 5 },
];

async function main() {
  const config = loadConfig({ NODE_ENV: 'development', LOG_LEVEL: 'silent', ...process.env } as NodeJS.ProcessEnv);
  const db = createPool(config.DATABASE_URL);
  await migrate(db, () => undefined);
  const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [EMAIL]);
  if (exists.rowCount) {
    console.log(`Demo data already exists. Sign in with ${EMAIL} / ${PASSWORD}`);
    await db.end();
    return;
  }
  const app = await buildApp({ config: { ...config, LOG_LEVEL: 'silent' }, db, sender: new ConsoleSender(() => undefined) });
  const call = async <T = Record<string, unknown>>(method: string, url: string, token?: string, payload?: unknown): Promise<T> => {
    const res = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
    if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
    return (res.body ? JSON.parse(res.body) : {}) as T;
  };

  const reg = await call<{ token: string; user: { id: string; tenantId: string } }>('POST', '/api/auth/register', undefined, {
    businessName: 'Sharma Pharma & FMCG Distributors', name: 'Ravi Sharma', email: EMAIL, password: PASSWORD,
  });
  const owner = reg.token;
  const tid = reg.user.tenantId;
  await call('PATCH', '/api/settings', owner, {
    gstin: '07AAACS1234A1Z5', address: '1421 Chandni Chowk, Delhi 110006', phone: '+91 98100 12345',
    upi_vpa: 'sharmapharma@okhdfcbank', upi_payee_name: 'Sharma Pharma', bill_prefix: 'SPD/', next_bill_no: 1001,
  });
  const salesmen: Array<{ id: string; name: string; token: string }> = [];
  for (const [name, email, target] of [['Amit Kumar', 'amit@creditledger.in', '25000'], ['Rahul Yadav', 'rahul@creditledger.in', '20000']] as const) {
    const u = await call<{ user: { id: string } }>('POST', '/api/settings/users', owner, { name, email, role: 'salesman', password: PASSWORD });
    await call('PATCH', `/api/settings/users/${u.user.id}`, owner, { daily_target: target });
    const login = await call<{ token: string }>('POST', '/api/auth/login', undefined, { email, password: PASSWORD });
    salesmen.push({ id: u.user.id, name, token: login.token });
  }
  await call('POST', '/api/settings/users', owner, { name: 'Neha Accounts', email: 'neha@creditledger.in', role: 'accountant', password: PASSWORD });

  const today = todayIso();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const beats: string[] = [];
  for (let b = 0; b < AREAS.length; b++) {
    const days = b === 0 ? [weekday, (weekday + 3) % 7] : b === 1 ? [(weekday + 1) % 7, (weekday + 4) % 7] : [(weekday + 2) % 7, (weekday + 5) % 7];
    const r = await call<{ beat: { id: string } }>('POST', '/api/beats', owner, {
      name: `${AREAS[b]!.area} route`, salesman_id: salesmen[b === 2 ? 1 : 0]!.id, weekdays: days,
    });
    beats.push(r.beat.id);
  }

  const customers: Array<{ id: string; name: string; beat: number }> = [];
  for (let i = 0; i < SHOPS.length; i++) {
    const b = i % 3;
    const a = AREAS[b]!;
    const c = await call<{ customer: { id: string } }>('POST', '/api/customers', owner, {
      name: SHOPS[i], phone: `98${String(10000000 + i * 7919).slice(0, 8)}`, contact_name: `${pick(OWNERS)} ${SHOPS[i]!.split(' ')[0]}`,
      area: a.area, address: `Shop ${10 + i}, Main Market, ${a.area}, Delhi`,
      credit_limit: String(pick([50000, 75000, 100000, 150000])), credit_days: pick([15, 21, 30, 30, 45]),
      language: i % 4 === 0 ? 'hi' : 'en', tags: i % 2 ? ['pharmacy'] : ['kirana'],
      gstin: i % 5 === 0 ? `07AAB${String.fromCharCode(65 + i)}S${1000 + i}A1Z${i % 9}` : i === 7 ? '09AAACB1234A1Z5' : null,
      ...(i % 6 !== 5 ? { lat: a.lat + (rnd() - 0.5) * 0.012, lng: a.lng + (rnd() - 0.5) * 0.012 } : {}),
    }).catch(async () =>
      call<{ customer: { id: string } }>('POST', '/api/customers', owner, { name: SHOPS[i], phone: `97${String(20000000 + i * 104729).slice(0, 8)}`, area: a.area }),
    );
    customers.push({ id: c.customer.id, name: SHOPS[i]!, beat: b });
  }
  for (let b = 0; b < beats.length; b++) {
    await call('PUT', `/api/beats/${beats[b]}/customers`, owner, { customer_ids: customers.filter((c) => c.beat === b).map((c) => c.id) });
  }

  // Two months of bills; payments for most of them (some late, some still open).
  for (let d = 60; d >= 1; d--) {
    const day = addDays(today, -d);
    const billsToday = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < billsToday; k++) {
      const c = pick(customers);
      const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
        const it = pick(ITEMS);
        return { ...it, qty: 2 + Math.floor(rnd() * 20) };
      });
      const bill = await call<{ bill: { id: string; total_paise: number } }>('POST', '/api/bills', owner, { customer_id: c.id, bill_date: day, items });
      const paid = rnd();
      if (paid < 0.62 && d > 3) {
        const payDay = addDays(day, Math.min(d - 1, 5 + Math.floor(rnd() * 30)));
        const amount = (bill.bill.total_paise / 100).toFixed(2);
        const mode = pick(['upi', 'upi', 'bank', 'cash', 'cheque'] as const);
        if (mode === 'cash' || mode === 'cheque') {
          // Field collection by a salesman (handed over, except the last few days).
          const s = salesmen[c.beat === 2 ? 1 : 0]!;
          await withTenant(db, tid, async (tx) => {
            await tx.query(
              `INSERT INTO ledger_entries (tenant_id, customer_id, kind, amount_paise, entry_date, payment_mode, payment_ref, collected_by, created_by, handed_over_at)
               VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7, $7, $8)`,
              [tid, c.id, bill.bill.total_paise, payDay, mode, mode === 'cheque' ? String(100000 + Math.floor(rnd() * 899999)) : null, s.id, payDay < addDays(today, -2) ? `${payDay}T18:00:00Z` : null],
            );
          });
        } else {
          await call('POST', `/api/customers/${c.id}/entries`, owner, {
            kind: 'payment', amount, entry_date: payDay, payment_mode: mode, payment_ref: `UTR${Math.floor(rnd() * 1e10)}`,
          });
        }
      } else if (paid < 0.75 && d > 10) {
        await call('POST', `/api/customers/${c.id}/entries`, owner, {
          kind: 'payment', amount: String(Math.round(bill.bill.total_paise / 200)), entry_date: addDays(day, 7), payment_mode: 'upi', payment_ref: `UTR${Math.floor(rnd() * 1e10)}`,
        });
      }
    }
  }

  // Today's field work: visits and a few collections on the current beat.
  const todays = customers.filter((c) => c.beat === 0).slice(0, 5);
  for (const [i, c] of todays.entries()) {
    const s = salesmen[0]!;
    const outcome = (['collected', 'promised', 'shop_closed', 'collected', 'no_payment'] as const)[i]!;
    if (outcome === 'collected') {
      await call('POST', '/api/collections', s.token, { customer_id: c.id, amount: String(1500 + i * 850), payment_mode: i % 2 ? 'upi' : 'cash', payment_ref: i % 2 ? `UTR${9000 + i}` : undefined });
    }
    await call('POST', '/api/visits', s.token, { customer_id: c.id, outcome, note: outcome === 'promised' ? 'Will pay on Saturday' : undefined });
  }
  for (let d = 1; d <= 6; d++) {
    for (const c of customers.filter((x) => x.beat === d % 3).slice(0, 4)) {
      await withTenant(db, tid, (tx) =>
        tx.query('INSERT INTO visits (tenant_id, customer_id, salesman_id, visited_on, outcome) VALUES ($1, $2, $3, $4, $5)', [
          tid, c.id, salesmen[d % 3 === 2 ? 1 : 0]!.id, addDays(today, -d), pick(['collected', 'promised', 'no_payment', 'order_taken'] as const),
        ]),
      );
    }
  }

  // A promise and a dispute.
  await withTenant(db, tid, async (tx) => {
    await tx.query(
      `INSERT INTO promises (tenant_id, customer_id, promised_date, amount_paise, source_text) VALUES ($1, $2, $3, 1500000, 'Saturday tak 15000 de dunga')`,
      [tid, customers[1]!.id, addDays(today, 1)],
    );
    await tx.query(
      `INSERT INTO disputes (tenant_id, customer_id, reason, message, raised_by) VALUES ($1, $2, 'return_not_applied', 'I returned 2 cartons of biscuits last week, please adjust.', 'retailer')`,
      [tid, customers[4]!.id],
    );
  });

  await app.close();
  await db.end();
  console.log(`Demo data created.\n  Owner:    ${EMAIL} / ${PASSWORD}\n  Salesman: amit@creditledger.in / ${PASSWORD}\n  Accountant: neha@creditledger.in / ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
