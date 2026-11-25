import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant, type Tx } from '../db.js';
import { addDays, todayIso } from '../domain/ledger.js';
import { amountInWords, computeBill, GST_RATES, isInterstate } from '../domain/gst.js';
import { rupeesToPaise } from '../domain/money.js';
import { buildUpiLink } from '../domain/upi.js';
import { qrSvg } from '../domain/qr.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const rate = z.union([z.number().nonnegative(), z.string()]).transform((v, ctx) => {
  try {
    return rupeesToPaise(typeof v === 'number' ? Number(v.toFixed(2)) : v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});

const item = z.object({
  description: z.string().trim().min(1, 'Item name is required').max(200),
  hsn: z.string().trim().regex(/^\d{4,8}$/, 'HSN/SAC must be 4 to 8 digits').nullable().optional().or(z.literal('').transform(() => null)),
  qty: z.coerce.number().positive('Quantity must be more than 0').max(1_000_000),
  unit: z.string().trim().min(1).max(10).default('pcs'),
  rate,
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  gst_rate: z.coerce.number().refine((r) => (GST_RATES as readonly number[]).includes(r), 'GST rate must be 0, 0.25, 3, 5, 12, 18 or 28'),
});

const billBody = z.object({
  customer_id: z.string().uuid(),
  bill_date: isoDate.optional(),
  due_date: isoDate.optional(),
  interstate: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(item).min(1, 'Add at least one item').max(200),
});

const BILL_COLUMNS =
  'b.id, b.customer_id, b.bill_no, b.bill_date, b.due_date, b.interstate, b.subtotal_paise, b.discount_paise, b.taxable_paise, ' +
  'b.cgst_paise, b.sgst_paise, b.igst_paise, b.round_off_paise, b.total_paise, b.notes, b.entry_id, b.cancelled_at, b.cancel_reason, b.created_at';

async function tenantInfo(tx: Tx) {
  return (
    await tx.query<{
      name: string; gstin: string | null; address: string | null; phone: string | null; state_code: string | null;
      upi_vpa: string | null; upi_payee_name: string | null; bill_prefix: string;
    }>('SELECT name, gstin, address, phone, state_code, upi_vpa, upi_payee_name, bill_prefix FROM tenants')
  ).rows[0]!;
}

function toItems(items: z.infer<typeof item>[]) {
  return items.map((i) => ({
    description: i.description, hsn: i.hsn ?? null, qty: i.qty, unit: i.unit, rate_paise: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate,
  }));
}

export async function billRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const staff = { preHandler: app.requireRole('owner', 'accountant') };
  const now = () => app.deps.now?.() ?? new Date();

  app.get('/', async (req) => {
    const q = z
      .object({
        customer_id: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        search: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      })
      .parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.customer_id) where.push(`b.customer_id = $${params.push(q.customer_id)}`);
      if (q.from) where.push(`b.bill_date >= $${params.push(q.from)}`);
      if (q.to) where.push(`b.bill_date <= $${params.push(q.to)}`);
      if (q.search) where.push(`(b.bill_no ILIKE $${params.push(`%${q.search}%`)} OR c.name ILIKE $${params.length})`);
      const res = await tx.query(
        `SELECT ${BILL_COLUMNS}, c.name AS customer_name FROM bills b JOIN customers c ON c.id = b.customer_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.bill_date DESC, b.created_at DESC LIMIT $${params.push(q.limit)}`,
        params,
      );
      return { bills: res.rows };
    });
  });

  /** Totals for a draft bill, so the form can show tax and total as you type. Nothing is saved. */
  app.post('/preview', async (req) => {
    const body = billBody.partial({ customer_id: true }).parse(req.body);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      let interstate = body.interstate ?? false;
      if (body.interstate === undefined && body.customer_id) {
        const t = await tenantInfo(tx);
        const c = await tx.query<{ gstin: string | null }>('SELECT gstin FROM customers WHERE id = $1', [body.customer_id]);
        interstate = isInterstate(t.state_code, c.rows[0]?.gstin ?? null);
      }
      try {
        return { interstate, ...computeBill(toItems(body.items), { interstate }) };
      } catch (e) {
        throw new HttpError(400, (e as Error).message, 'invalid_bill');
      }
    });
  });

  /** Create a GST bill. It gets the next bill number and posts an invoice to the customer's ledger. */
  app.post('/', staff, async (req, reply) => {
    const body = billBody.parse(req.body);
    const billDate = body.bill_date ?? todayIso(now());
    const bill = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const c = await tx.query<{ credit_days: number; gstin: string | null; archived_at: string | null }>(
        'SELECT credit_days, gstin, archived_at FROM customers WHERE id = $1',
        [body.customer_id],
      );
      if (!c.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      const t = await tenantInfo(tx);
      const interstate = body.interstate ?? isInterstate(t.state_code, c.rows[0].gstin);
      let totals;
      try {
        totals = computeBill(toItems(body.items), { interstate });
      } catch (e) {
        throw new HttpError(400, (e as Error).message, 'invalid_bill');
      }
      const due = body.due_date ?? addDays(billDate, c.rows[0].credit_days);
      if (due < billDate) throw new HttpError(400, 'Due date cannot be before the bill date', 'bad_date');
      const num = await tx.query<{ n: number }>('UPDATE tenants SET next_bill_no = next_bill_no + 1 RETURNING next_bill_no - 1 AS n');
      const billNo = `${t.bill_prefix}${num.rows[0]!.n}`;
      const entry = await tx.query<{ id: string }>(
        `INSERT INTO ledger_entries (tenant_id, customer_id, kind, amount_paise, entry_date, due_date, reference, note, created_by)
         VALUES ($1, $2, 'invoice', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.user.tid, body.customer_id, totals.total_paise, billDate, due, billNo, `GST bill ${billNo}`, req.user.sub],
      );
      const b = await tx.query<{ id: string }>(
        `INSERT INTO bills (tenant_id, customer_id, bill_no, bill_date, due_date, interstate, subtotal_paise, discount_paise, taxable_paise,
                            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, notes, entry_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          req.user.tid, body.customer_id, billNo, billDate, due, interstate, totals.subtotal_paise, totals.discount_paise, totals.taxable_paise,
          totals.cgst_paise, totals.sgst_paise, totals.igst_paise, totals.round_off_paise, totals.total_paise, body.notes ?? null,
          entry.rows[0]!.id, req.user.sub,
        ],
      );
      let pos = 0;
      for (const l of totals.lines) {
        await tx.query(
          `INSERT INTO bill_items (tenant_id, bill_id, position, description, hsn, qty, unit, rate_paise, discount_pct, gst_rate, taxable_paise, tax_paise, amount_paise)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [req.user.tid, b.rows[0]!.id, pos++, l.description, l.hsn, l.qty, l.unit, l.rate_paise, l.discount_pct, l.gst_rate, l.taxable_paise, l.tax_paise, l.amount_paise],
        );
      }
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'bill.created', b.rows[0]!.id, { bill_no: billNo, total_paise: totals.total_paise });
      return { id: b.rows[0]!.id, bill_no: billNo, total_paise: totals.total_paise };
    });
    return reply.status(201).send({ bill });
  });

  /** Full bill for viewing/printing, with seller details and a UPI QR for the bill amount. */
  app.get('/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const b = (
        await tx.query(
          `SELECT ${BILL_COLUMNS}, c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin, c.address AS customer_address
           FROM bills b JOIN customers c ON c.id = b.customer_id WHERE b.id = $1`,
          [id],
        )
      ).rows[0];
      if (!b) throw new HttpError(404, 'Bill not found', 'not_found');
      const items = (
        await tx.query(
          `SELECT description, hsn, qty::float8 AS qty, unit, rate_paise, discount_pct::float8 AS discount_pct, gst_rate::float8 AS gst_rate,
                  taxable_paise, tax_paise, amount_paise FROM bill_items WHERE bill_id = $1 ORDER BY position`,
          [id],
        )
      ).rows;
      const seller = await tenantInfo(tx);
      let upi: { link: string; qr_svg: string } | null = null;
      if (seller.upi_vpa && !b.cancelled_at) {
        const link = buildUpiLink({
          vpa: seller.upi_vpa,
          payeeName: seller.upi_payee_name ?? seller.name,
          amountPaise: b.total_paise,
          note: `Bill ${b.bill_no}`,
          transactionRef: b.bill_no,
        });
        upi = { link, qr_svg: await qrSvg(link) };
      }
      const byRate = new Map<number, { taxable_paise: number; tax_paise: number }>();
      for (const it of items) {
        const r = byRate.get(it.gst_rate) ?? { taxable_paise: 0, tax_paise: 0 };
        r.taxable_paise += Number(it.taxable_paise);
        r.tax_paise += Number(it.tax_paise);
        byRate.set(it.gst_rate, r);
      }
      return {
        bill: { ...b, amount_in_words: amountInWords(b.total_paise) },
        items,
        tax_summary: [...byRate.entries()].sort((a, c) => a[0] - c[0]).map(([gst_rate, v]) => ({ gst_rate, ...v })),
        seller: { name: seller.name, gstin: seller.gstin, address: seller.address, phone: seller.phone, state_code: seller.state_code },
        upi,
      };
    });
  });

  /** Cancel a bill: posts a credit note that reverses the invoice. The bill stays on record. */
  app.post('/:id/cancel', staff, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).parse(req.body);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const b = (await tx.query('SELECT id, customer_id, bill_no, total_paise, cancelled_at FROM bills WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!b) throw new HttpError(404, 'Bill not found', 'not_found');
      if (b.cancelled_at) throw new HttpError(409, 'This bill is already cancelled', 'already_cancelled');
      const today = todayIso(now());
      const entry = await tx.query<{ id: string }>(
        `INSERT INTO ledger_entries (tenant_id, customer_id, kind, amount_paise, entry_date, reference, note, created_by)
         VALUES ($1, $2, 'credit_note', $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.tid, b.customer_id, b.total_paise, today, b.bill_no, `Cancelled bill ${b.bill_no}: ${reason}`, req.user.sub],
      );
      await tx.query('UPDATE bills SET cancelled_at = now(), cancel_entry_id = $1, cancel_reason = $2 WHERE id = $3', [entry.rows[0]!.id, reason, id]);
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'bill.cancelled', id, { reason });
      return { ok: true };
    });
  });
}
