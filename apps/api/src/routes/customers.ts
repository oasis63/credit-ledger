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
});

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
    const q = z.object({ search: z.string().max(100).optional() }).parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      let list = await customerSummaries(tx, todayIso(now()));
      if (q.search) {
        const s = q.search.toLowerCase();
        list = list.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
      }
      return { customers: list };
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
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'customer.created', res.rows[0]!.id);
      return res.rows[0];
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
      };
    });
  });

  app.patch('/:id', staff, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = customerBody.partial().parse(req.body);
    const map: Record<string, unknown> = {
      name: body.name,
      phone: body.phone,
      gstin: body.gstin,
      credit_limit_paise: body.credit_limit,
      credit_days: body.credit_days,
      language: body.language,
    };
    const keys = Object.keys(map).filter((k) => map[k] !== undefined);
    if (keys.length === 0) throw new HttpError(400, 'Nothing to update', 'empty_update');
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query<CustomerRow>(
        `UPDATE customers SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING ${CUSTOMER_COLUMNS}`,
        [...keys.map((k) => map[k]), id],
      );
      if (!res.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'customer.updated', id, { fields: keys });
      return { customer: res.rows[0] };
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
