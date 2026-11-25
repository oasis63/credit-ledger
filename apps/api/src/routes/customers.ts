import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { aging, balanceOf, openItems, statement, todayIso } from '../domain/ledger.js';
import { rupeesToPaise } from '../domain/money.js';
import { assessRisk } from '../domain/risk.js';
import { signStatementToken } from '../domain/statementToken.js';
import { CUSTOMER_COLUMNS, customerSummaries, ENTRY_COLUMNS, type CustomerRow } from '../services/customers.js';
import { normalisePhone } from '../services/whatsapp.js';
import { buildUpiLink } from '../domain/upi.js';
import { qrSvg } from '../domain/qr.js';

const amount = z.union([z.number().nonnegative(), z.string()]).transform((v, ctx) => {
  try {
    return rupeesToPaise(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});

const phone = z.string().transform((v, ctx) => {
  const n = normalisePhone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
    return z.NEVER;
  }
  return n;
});

const customerBody = z.object({
  name: z.string().trim().min(1).max(200),
  phone,
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN')
    .nullable()
    .optional(),
  credit_limit: amount.optional(),
  credit_days: z.number().int().min(0).max(365).optional(),
  language: z.enum(['en', 'hi']).optional(),
  contact_name: z.string().trim().max(100).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  area: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  beat_id: z.string().uuid().nullable().optional(),
});

const EDITABLE = ['name', 'phone', 'gstin', 'credit_limit', 'credit_days', 'language', 'contact_name', 'address', 'area', 'tags', 'lat', 'lng', 'beat_id'] as const;
const COLUMN: Record<(typeof EDITABLE)[number], string> = {
  name: 'name', phone: 'phone', gstin: 'gstin', credit_limit: 'credit_limit_paise', credit_days: 'credit_days', language: 'language',
  contact_name: 'contact_name', address: 'address', area: 'area', tags: 'tags', lat: 'lat', lng: 'lng', beat_id: 'beat_id',
};

/** One row from a CSV/Excel import. Amounts arrive as text from spreadsheets. */
const importRow = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  phone: z.union([z.string(), z.number()]).transform((v) => String(v)),
  contact_name: z.string().trim().max(100).optional(),
  gstin: z.string().trim().max(20).optional(),
  area: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  credit_limit: z.union([z.string(), z.number()]).optional(),
  credit_days: z.union([z.string(), z.number()]).optional(),
  opening_balance: z.union([z.string(), z.number()]).optional(),
  language: z.string().optional(),
  tags: z.string().optional(),
});

function cleanAmount(v: string | number | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const s = String(v).replace(/[₹,\s]/g, '');
  if (s === '') return undefined;
  return rupeesToPaise(s);
}

const idParam = z.object({ id: z.string().uuid() });

export function statementUrl(base: string, tenantId: string, customerId: string, secret: string, ttlDays: number, now: Date) {
  const exp = Math.floor(now.getTime() / 1000) + ttlDays * 86_400;
  const token = signStatementToken({ tid: tenantId, cid: customerId, exp }, secret);
  return `${base.replace(/\/$/, '')}/s/${token}`;
}

export async function customerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const staff = { preHandler: app.requireRole('owner', 'accountant') };
  const now = () => app.deps.now?.() ?? new Date();

  app.get('/', async (req) => {
    const q = z
      .object({
        search: z.string().max(100).optional(),
        area: z.string().max(100).optional(),
        tag: z.string().max(40).optional(),
        beat_id: z.string().uuid().optional(),
        archived: z.enum(['0', '1']).optional(),
      })
      .parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      let list = await customerSummaries(tx, todayIso(now()), { includeArchived: q.archived === '1' });
      if (q.archived === '1') list = list.filter((c) => c.archived_at);
      if (q.search) {
        const s = q.search.toLowerCase();
        list = list.filter(
          (c) => c.name.toLowerCase().includes(s) || c.phone.includes(s) || (c.contact_name ?? '').toLowerCase().includes(s) || (c.area ?? '').toLowerCase().includes(s),
        );
      }
      if (q.area) list = list.filter((c) => (c.area ?? '').toLowerCase() === q.area!.toLowerCase());
      if (q.tag) list = list.filter((c) => c.tags.includes(q.tag!.toLowerCase()));
      if (q.beat_id) list = list.filter((c) => c.beat_id === q.beat_id);
      return { customers: list };
    });
  });

  /** Distinct areas and tags, for filters and autocomplete. */
  app.get('/facets', async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const areas = await tx.query<{ area: string; n: number }>(
        'SELECT area, count(*)::int AS n FROM customers WHERE area IS NOT NULL AND archived_at IS NULL GROUP BY area ORDER BY area',
      );
      const tags = await tx.query<{ tag: string; n: number }>(
        'SELECT tag, count(*)::int AS n FROM customers, unnest(tags) AS tag WHERE archived_at IS NULL GROUP BY tag ORDER BY tag',
      );
      return { areas: areas.rows, tags: tags.rows };
    });
  });

  /**
   * Bulk import from a spreadsheet. Validates every row first; with dry_run
   * nothing is written. Rows whose phone already exists are skipped or
   * updated. Opening balances become opening_balance ledger entries.
   */
  app.post('/import', staff, async (req) => {
    const body = z
      .object({
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
        on_duplicate: z.enum(['skip', 'update']).default('skip'),
        dry_run: z.boolean().default(false),
        opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.body);
    const errors: Array<{ row: number; message: string }> = [];
    const valid: Array<{ row: number; data: Record<string, unknown>; opening: number | undefined }> = [];
    const seenPhones = new Set<string>();
    body.rows.forEach((raw, i) => {
      const rowNo = i + 2; // spreadsheet row (row 1 is the header)
      const parsed = importRow.safeParse(raw);
      if (!parsed.success) {
        errors.push({ row: rowNo, message: parsed.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`).join('; ') });
        return;
      }
      const r = parsed.data;
      const ph = normalisePhone(r.phone);
      if (!ph) return void errors.push({ row: rowNo, message: `Phone "${r.phone}" is not a valid Indian mobile number` });
      if (seenPhones.has(ph)) return void errors.push({ row: rowNo, message: `Phone ${ph} appears twice in the file` });
      seenPhones.add(ph);
      const gstin = r.gstin ? r.gstin.toUpperCase() : null;
      if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return void errors.push({ row: rowNo, message: `Invalid GSTIN ${gstin}` });
      let limit: number | undefined;
      let opening: number | undefined;
      try {
        limit = cleanAmount(r.credit_limit);
        opening = cleanAmount(r.opening_balance);
      } catch (e) {
        return void errors.push({ row: rowNo, message: (e as Error).message });
      }
      const days = r.credit_days === undefined || r.credit_days === '' ? undefined : Number(r.credit_days);
      if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 365)) {
        return void errors.push({ row: rowNo, message: 'Credit days must be a whole number from 0 to 365' });
      }
      const lang = (r.language ?? '').toLowerCase().startsWith('h') ? 'hi' : r.language ? 'en' : undefined;
      valid.push({
        row: rowNo,
        opening,
        data: {
          name: r.name, phone: ph, gstin, contact_name: r.contact_name || null, area: r.area || null, address: r.address || null,
          credit_limit_paise: limit, credit_days: days, language: lang,
          tags: r.tags ? [...new Set(r.tags.split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : undefined,
        },
      });
    });

    const asOf = body.opening_date ?? todayIso(now());
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const existing = new Map(
        (await tx.query<{ id: string; phone: string }>('SELECT id, phone FROM customers')).rows.map((r) => [r.phone, r.id]),
      );
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let openings = 0;
      for (const v of valid) {
        const id = existing.get(v.data.phone as string);
        if (id && body.on_duplicate === 'skip') {
          skipped++;
          continue;
        }
        if (body.dry_run) {
          if (id) updated++;
          else created++;
          if (!id && v.opening) openings++;
          continue;
        }
        const cols = Object.entries(v.data).filter(([, val]) => val !== undefined);
        if (id) {
          await tx.query(
            `UPDATE customers SET ${cols.map(([k], i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`,
            [...cols.map(([, val]) => val), id],
          );
          updated++;
        } else {
          const res = await tx.query<{ id: string }>(
            `INSERT INTO customers (tenant_id, ${cols.map(([k]) => k).join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
            [req.user.tid, ...cols.map(([, val]) => val)],
          );
          created++;
          // Opening balances only for new customers: re-importing never doubles a balance.
          if (v.opening && v.opening > 0) {
            await tx.query(
              `INSERT INTO ledger_entries (tenant_id, customer_id, kind, amount_paise, entry_date, due_date, note, created_by)
               VALUES ($1, $2, 'opening_balance', $3, $4, $4, 'Imported opening balance', $5)`,
              [req.user.tid, res.rows[0]!.id, v.opening, asOf, req.user.sub],
            );
            openings++;
          }
        }
      }
      if (!body.dry_run) {
        await audit(tx, req.user.tid, `user:${req.user.sub}`, 'customers.imported', null, { created, updated, skipped, errors: errors.length });
      }
      return { dry_run: body.dry_run, created, updated, skipped, opening_balances: openings, errors };
    });
  });

  app.post('/', staff, async (req, reply) => {
    const body = customerBody.parse(req.body);
    const customer = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query<CustomerRow>(
        `INSERT INTO customers (tenant_id, name, phone, gstin, credit_limit_paise, credit_days, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CUSTOMER_COLUMNS}`,
        [req.user.tid, body.name, body.phone, body.gstin ?? null, body.credit_limit ?? 0, body.credit_days ?? 30, body.language ?? 'en'],
      );
      const row = res.rows[0]!;
      const extra = EDITABLE.filter((k) => !['name', 'phone', 'gstin', 'credit_limit', 'credit_days', 'language'].includes(k) && body[k] !== undefined);
      if (extra.length) {
        const upd = await tx.query<CustomerRow>(
          `UPDATE customers SET ${extra.map((k, i) => `${COLUMN[k]} = $${i + 1}`).join(', ')} WHERE id = $${extra.length + 1} RETURNING ${CUSTOMER_COLUMNS}`,
          [...extra.map((k) => body[k]), row.id],
        );
        Object.assign(row, upd.rows[0]);
      }
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'customer.created', row.id);
      return row;
    });
    return reply.status(201).send({ customer });
  });

  app.get('/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const asOf = todayIso(now());
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const c = (await tx.query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = $1`, [id])).rows[0];
      if (!c) throw new HttpError(404, 'Customer not found', 'not_found');
      const entries = (await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE customer_id = $1`, [id])).rows;
      const disputes = (await tx.query('SELECT * FROM disputes WHERE customer_id = $1 ORDER BY created_at DESC', [id])).rows;
      const promises = (await tx.query('SELECT * FROM promises WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [id])).rows;
      const reminders = (await tx.query('SELECT * FROM reminders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [id])).rows;
      const bills = (
        await tx.query(
          'SELECT id, bill_no, bill_date, due_date, total_paise, cancelled_at FROM bills WHERE customer_id = $1 ORDER BY bill_date DESC, created_at DESC LIMIT 50',
          [id],
        )
      ).rows;
      const visits = (
        await tx.query(
          `SELECT v.id, v.visited_on, v.outcome, v.note, u.name AS salesman_name, v.created_at FROM visits v JOIN users u ON u.id = v.salesman_id
           WHERE v.customer_id = $1 ORDER BY v.created_at DESC LIMIT 20`,
          [id],
        )
      ).rows;
      const beat = c.beat_id ? (await tx.query('SELECT id, name FROM beats WHERE id = $1', [c.beat_id])).rows[0] ?? null : null;
      const risk = assessRisk({
        entries,
        credit_limit_paise: c.credit_limit_paise,
        open_disputes: disputes.filter((d) => d.status === 'open').length,
        broken_promises: promises.filter((p) => p.status === 'broken').length,
        as_of: asOf,
      });
      return {
        customer: c,
        balance_paise: balanceOf(entries),
        aging: aging(entries, asOf),
        open_items: openItems(entries, asOf).items,
        statement: statement(entries),
        risk,
        disputes,
        promises,
        reminders,
        bills,
        visits,
        beat,
      };
    });
  });

  app.patch('/:id', staff, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = customerBody.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const map: Record<string, unknown> = {};
    for (const k of EDITABLE) if (body[k] !== undefined) map[COLUMN[k]] = body[k];
    if (body.archived !== undefined) map.archived_at = body.archived ? now().toISOString() : null;
    const keys = Object.keys(map);
    if (keys.length === 0) throw new HttpError(400, 'Nothing to update', 'empty_update');
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      if (body.archived) {
        const entries = (await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE customer_id = $1`, [id])).rows;
        if (balanceOf(entries) !== 0) throw new HttpError(400, 'Settle the balance before archiving this customer', 'balance_not_zero');
      }
      const res = await tx.query<CustomerRow>(
        `UPDATE customers SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING ${CUSTOMER_COLUMNS}`,
        [...keys.map((k) => map[k]), id],
      );
      if (!res.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'customer.updated', id, { fields: keys });
      return { customer: res.rows[0] };
    });
  });

  /** UPI QR for paying this customer's balance (or a given amount), as SVG. */
  app.get('/:id/upi-qr', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ amount: amount.optional() }).parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const c = (await tx.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [id])).rows[0];
      if (!c) throw new HttpError(404, 'Customer not found', 'not_found');
      const t = (await tx.query<{ name: string; upi_vpa: string | null; upi_payee_name: string | null }>('SELECT name, upi_vpa, upi_payee_name FROM tenants')).rows[0]!;
      if (!t.upi_vpa) throw new HttpError(400, 'Add your UPI ID in Settings first', 'no_upi');
      let amountPaise = q.amount;
      if (!amountPaise) {
        const entries = (await tx.query(`SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE customer_id = $1`, [id])).rows;
        amountPaise = balanceOf(entries);
      }
      if (!amountPaise || amountPaise <= 0) throw new HttpError(400, 'Nothing to pay: the balance is zero', 'nothing_due');
      const link = buildUpiLink({ vpa: t.upi_vpa, payeeName: t.upi_payee_name ?? t.name, amountPaise, note: `Payment from ${c.name}`.slice(0, 80) });
      return { link, amount_paise: amountPaise, vpa: t.upi_vpa, payee: t.upi_payee_name ?? t.name, svg: await qrSvg(link) };
    });
  });

  app.post('/:id/statement-link', async (req) => {
    const { id } = idParam.parse(req.params);
    await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query('SELECT 1 FROM customers WHERE id = $1', [id]);
      if (!res.rowCount) throw new HttpError(404, 'Customer not found', 'not_found');
    });
    const { config } = app.deps;
    return {
      url: statementUrl(config.PUBLIC_WEB_URL, req.user.tid, id, config.STATEMENT_LINK_SECRET, config.STATEMENT_LINK_TTL_DAYS, now()),
      expires_in_days: config.STATEMENT_LINK_TTL_DAYS,
    };
  });
}
