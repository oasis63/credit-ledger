import { describe, expect, it } from 'vitest';
import { formatRupees, rupeesToPaise } from '../src/domain/money.js';
import { addDays, aging, balanceOf, openItems, statement, todayIso, type LedgerEntry } from '../src/domain/ledger.js';
import { assessRisk } from '../src/domain/risk.js';
import { buildUpiLink, isValidVpa } from '../src/domain/upi.js';
import { signStatementToken, verifyStatementToken } from '../src/domain/statementToken.js';
import { parsePromise } from '../src/domain/promiseParser.js';
import { hashPassword, verifyPassword, newAgentKey, hashAgentKey } from '../src/domain/password.js';
import { extractInboundTexts, normalisePhone, verifyWebhookSignature } from '../src/services/whatsapp.js';
import { createHmac } from 'node:crypto';

const e = (id: string, kind: LedgerEntry['kind'], rupees: number, entry_date: string, due_date: string | null = null): LedgerEntry => ({
  id,
  kind,
  amount_paise: rupees * 100,
  entry_date,
  due_date,
});

describe('money', () => {
  it('converts rupees to paise exactly', () => {
    expect(rupeesToPaise('1234.5')).toBe(123450);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(() => rupeesToPaise('1.234')).toThrow();
    expect(() => rupeesToPaise('-5')).toThrow();
    expect(() => rupeesToPaise('abc')).toThrow();
  });
  it('formats with Indian digit grouping', () => {
    expect(formatRupees(123456789)).toBe('₹12,34,567.89');
    expect(formatRupees(100000)).toBe('₹1,000');
    expect(formatRupees(50)).toBe('₹0.50');
    expect(formatRupees(-250000)).toBe('-₹2,500');
  });
});

describe('ledger', () => {
  const entries = [
    e('a', 'invoice', 1000, '2026-01-01', '2026-01-31'),
    e('b', 'invoice', 2000, '2026-02-01', '2026-03-03'),
    e('c', 'payment', 1500, '2026-02-10'),
    e('d', 'invoice', 500, '2026-04-20', '2026-05-20'),
  ];

  it('computes balance with debits and credits', () => {
    expect(balanceOf(entries)).toBe(200000);
  });

  it('builds a running statement in date order', () => {
    const s = statement([...entries].reverse());
    expect(s.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.at(-1)!.running_balance_paise).toBe(200000);
    expect(s[2]!.credit_paise).toBe(150000);
  });

  it('allocates credits FIFO to the oldest due bills', () => {
    const { items, unapplied_credit_paise } = openItems(entries, '2026-05-01');
    expect(unapplied_credit_paise).toBe(0);
    // Invoice a fully paid; b has 1500 open; d not due.
    expect(items.map((i) => [i.entry_id, i.open_paise])).toEqual([
      ['b', 150000],
      ['d', 50000],
    ]);
    expect(items[0]!.days_overdue).toBe(59);
  });

  it('ages open items into buckets', () => {
    expect(aging(entries, '2026-05-01')).toEqual({ not_due: 50000, d1_30: 0, d31_60: 150000, d61_90: 0, d90_plus: 0 });
  });

  it('keeps advance payments as unapplied credit', () => {
    const r = openItems([e('x', 'payment', 100, '2026-01-01')], '2026-01-02');
    expect(r.items).toEqual([]);
    expect(r.unapplied_credit_paise).toBe(10000);
  });

  it('handles date helpers', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(todayIso(new Date('2026-03-31T20:00:00Z'))).toBe('2026-04-01'); // IST is ahead
  });
});

describe('risk', () => {
  it('flags green for a clean account', () => {
    const r = assessRisk({ entries: [e('a', 'invoice', 100, '2026-05-01', '2026-05-31')], credit_limit_paise: 0, open_disputes: 0, broken_promises: 0, as_of: '2026-05-10' });
    expect(r.flag).toBe('green');
    expect(r.reasons).toEqual([]);
  });

  it('flags red for very overdue, over-limit accounts with bounces', () => {
    const r = assessRisk({
      entries: [e('a', 'invoice', 5000, '2026-01-01', '2026-01-15'), e('b', 'cheque_bounce', 1000, '2026-02-01', '2026-02-01')],
      credit_limit_paise: 100000,
      open_disputes: 1,
      broken_promises: 1,
      as_of: '2026-05-01',
    });
    expect(r.flag).toBe('red');
    expect(r.score).toBe(100);
    expect(r.reasons.join(' ')).toMatch(/overdue/);
    expect(r.reasons.join(' ')).toMatch(/credit limit/);
  });
});

describe('upi', () => {
  it('validates VPAs', () => {
    expect(isValidVpa('sharma.traders@okhdfcbank')).toBe(true);
    expect(isValidVpa('no-at-sign')).toBe(false);
  });
  it('builds a pay link to the distributor VPA', () => {
    const link = buildUpiLink({ vpa: 'shop@okicici', payeeName: 'Sharma Traders', amountPaise: 1234550, note: 'Invoice 42' });
    expect(link).toBe('upi://pay?pa=shop%40okicici&pn=Sharma%20Traders&am=12345.50&cu=INR&tn=Invoice%2042');
    expect(() => buildUpiLink({ vpa: 'bad', payeeName: 'x', amountPaise: 1, note: '' })).toThrow();
  });
});

describe('statement tokens', () => {
  const secret = 'x'.repeat(40);
  it('round-trips and rejects tampering and expiry', () => {
    const t = signStatementToken({ tid: 't1', cid: 'c1', exp: 2000 }, secret);
    expect(verifyStatementToken(t, secret, 1000)).toEqual({ tid: 't1', cid: 'c1', exp: 2000 });
    expect(verifyStatementToken(t, secret, 3000)).toBeNull();
    expect(verifyStatementToken(t, 'y'.repeat(40), 1000)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ tid: 't2', cid: 'c1', exp: 2000 })).toString('base64url');
    expect(verifyStatementToken(`${forged}.${sig}`, secret, 1000)).toBeNull();
    expect(verifyStatementToken(`${body}`, secret, 1000)).toBeNull();
  });
});

describe('promise parser', () => {
  const today = '2026-11-25'; // Wednesday
  it.each([
    ['kal payment kar dunga', '2026-11-26'],
    ['Will pay tomorrow', '2026-11-26'],
    ['parso de dunga bhai', '2026-11-27'],
    ['agle hafte pakka', '2026-11-30'],
    ['monday ko bhejta hu', '2026-11-30'],
    ['payment on 5/12', '2026-12-05'],
    ['in 10 days', '2026-12-05'],
    ['month end tak', '2026-11-30'],
    ['aaj shaam tak', '2026-11-25'],
  ])('parses "%s"', (text, date) => {
    expect(parsePromise(text, today)?.promised_date).toBe(date);
  });
  it('reads amounts', () => {
    expect(parsePromise('kal ₹5,000 bhejunga', today)?.amount_paise).toBe(500000);
    expect(parsePromise('tomorrow 2500 rs', today)?.amount_paise).toBe(250000);
  });
  it('ignores messages without a date', () => {
    expect(parsePromise('ok thank you', today)).toBeNull();
  });
  it('rolls past dates to next year', () => {
    expect(parsePromise('pay on 10/01', today)?.promised_date).toBe('2027-01-10');
  });
});

describe('security helpers', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('creates agent keys stored only as hashes', () => {
    const { key, hash } = newAgentKey();
    expect(key.startsWith('clk_')).toBe(true);
    expect(hashAgentKey(key)).toBe(hash);
  });
  it('normalises Indian phone numbers', () => {
    expect(normalisePhone('98765 43210')).toBe('919876543210');
    expect(normalisePhone('+91-98765-43210')).toBe('919876543210');
    expect(normalisePhone('09876543210')).toBe('919876543210');
    expect(normalisePhone('12345')).toBeNull();
  });
  it('verifies webhook signatures', () => {
    const body = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig, 'secret')).toBe(true);
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, 'secret')).toBe(false);
  });
  it('extracts inbound texts from webhook payloads', () => {
    const payload = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [{ from: '919876543210', id: 'm1', type: 'text', text: { body: 'kal' } }, { from: 'x', id: 'm2', type: 'image' }] } }] }],
    };
    expect(extractInboundTexts(payload)).toEqual([{ phoneNumberId: '123', from: '919876543210', text: 'kal', messageId: 'm1' }]);
    expect(extractInboundTexts(null)).toEqual([]);
  });
});
