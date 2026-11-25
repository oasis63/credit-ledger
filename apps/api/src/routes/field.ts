import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { addDays, todayIso } from '../domain/ledger.js';
import { customerSummaries } from '../services/customers.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const VISIT_OUTCOMES = ['collected', 'promised', 'no_payment', 'shop_closed', 'owner_absent', 'order_taken'] as const;

const beatBody = z.object({
  name: z.string().trim().min(1).max(100),
  salesman_id: z.string().uuid().nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
});

/** Weekday (0 = Sunday) of a YYYY-MM-DD date, independent of server time zone. */
export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Beats (routes) and field work: today's route, visits and check-ins. */
export async function fieldRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const staff = { preHandler: app.requireRole('owner', 'accountant') };
  const now = () => app.deps.now?.() ?? new Date();

  // ---------- beats ----------
  app.get('/beats', async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `SELECT b.id, b.name, b.salesman_id, u.name AS salesman_name, b.weekdays,
                (SELECT count(*)::int FROM customers c WHERE c.beat_id = b.id AND c.archived_at IS NULL) AS customer_count
         FROM beats b LEFT JOIN users u ON u.id = b.salesman_id ORDER BY b.name`,
      );
      return { beats: res.rows };
    });
  });

  app.post('/beats', staff, async (req, reply) => {
    const body = beatBody.parse(req.body);
    const beat = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        'INSERT INTO beats (tenant_id, name, salesman_id, weekdays) VALUES ($1, $2, $3, $4) RETURNING id, name, salesman_id, weekdays',
        [req.user.tid, body.name, body.salesman_id ?? null, [...new Set(body.weekdays)].sort()],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'beat.created', res.rows[0].id);
      return res.rows[0];
    });
    return reply.status(201).send({ beat });
  });

  app.patch('/beats/:id', staff, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = beatBody.partial().parse(req.body);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.name !== undefined) sets.push(`name = $${params.push(body.name)}`);
      if (body.salesman_id !== undefined) sets.push(`salesman_id = $${params.push(body.salesman_id)}`);
      if (body.weekdays !== undefined) sets.push(`weekdays = $${params.push([...new Set(body.weekdays)].sort())}`);
      if (!sets.length) throw new HttpError(400, 'Nothing to update', 'empty_update');
      const res = await tx.query(`UPDATE beats SET ${sets.join(', ')} WHERE id = $${params.push(id)} RETURNING id, name, salesman_id, weekdays`, params);
      if (!res.rows[0]) throw new HttpError(404, 'Beat not found', 'not_found');
      return { beat: res.rows[0] };
    });
  });

  app.delete('/beats/:id', staff, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query('DELETE FROM beats WHERE id = $1', [id]);
      if (!res.rowCount) throw new HttpError(404, 'Beat not found', 'not_found');
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'beat.deleted', id);
    });
    return reply.status(204).send();
  });

  /** Set the shops on a beat, in visiting order. Shops removed from the list leave the beat. */
  app.put('/beats/:id/customers', staff, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { customer_ids } = z.object({ customer_ids: z.array(z.string().uuid()).max(2000) }).parse(req.body);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const b = await tx.query('SELECT 1 FROM beats WHERE id = $1', [id]);
      if (!b.rowCount) throw new HttpError(404, 'Beat not found', 'not_found');
      await tx.query('UPDATE customers SET beat_id = NULL, beat_order = 0 WHERE beat_id = $1 AND NOT (id = ANY($2))', [id, customer_ids]);
      for (let i = 0; i < customer_ids.length; i++) {
        await tx.query('UPDATE customers SET beat_id = $1, beat_order = $2 WHERE id = $3', [id, i + 1, customer_ids[i]]);
      }
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'beat.customers_set', id, { count: customer_ids.length });
      return { ok: true, count: customer_ids.length };
    });
  });

  // ---------- today's route ----------
  /**
   * The day plan for a salesman: shops on the beats scheduled for that weekday
   * (in order), each with balance, overdue amount and today's visit, plus the
   * daily target and what has been collected so far.
   */
  app.get('/field/today', async (req) => {
    const q = z.object({ date: isoDate.optional(), salesman_id: z.string().uuid().optional() }).parse(req.query);
    const date = q.date ?? todayIso(now());
    if (req.user.role === 'salesman' && q.salesman_id && q.salesman_id !== req.user.sub) {
      throw new HttpError(403, 'You can only see your own route', 'forbidden');
    }
    const salesmanId = q.salesman_id ?? req.user.sub;
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const user = (await tx.query<{ id: string; name: string; daily_target_paise: number }>('SELECT id, name, daily_target_paise FROM users WHERE id = $1', [salesmanId])).rows[0];
      if (!user) throw new HttpError(404, 'Salesman not found', 'not_found');
      const weekday = weekdayOf(date);
      const allBeats = (await tx.query<{ id: string; name: string; weekdays: number[] }>('SELECT id, name, weekdays FROM beats WHERE salesman_id = $1 ORDER BY name', [salesmanId])).rows;
      const todays = allBeats.filter((b) => b.weekdays.includes(weekday));
      const beatIds = new Set(todays.map((b) => b.id));
      const summaries = await customerSummaries(tx, date);
      const visits = (
        await tx.query<{ customer_id: string; outcome: string; note: string | null; created_at: string }>(
          'SELECT customer_id, outcome, note, created_at FROM visits WHERE salesman_id = $1 AND visited_on = $2 ORDER BY created_at',
          [salesmanId, date],
        )
      ).rows;
      const lastVisit = new Map(visits.map((v) => [v.customer_id, v]));
      const collected = await tx.query<{ total: number | null; n: number }>(
        `SELECT sum(amount_paise)::bigint AS total, count(*)::int AS n FROM ledger_entries
         WHERE kind = 'payment' AND collected_by = $1 AND entry_date = $2`,
        [salesmanId, date],
      );
      const beatName = new Map(allBeats.map((b) => [b.id, b.name]));
      const stops = summaries
        .filter((c) => c.beat_id && beatIds.has(c.beat_id))
        .sort((a, b) => (beatName.get(a.beat_id!) ?? '').localeCompare(beatName.get(b.beat_id!) ?? '') || a.beat_order - b.beat_order)
        .map((c) => ({
          id: c.id, name: c.name, phone: c.phone, contact_name: c.contact_name, area: c.area, address: c.address, lat: c.lat, lng: c.lng,
          beat_id: c.beat_id, beat_name: beatName.get(c.beat_id!) ?? null,
          balance_paise: c.balance_paise, overdue_paise: c.overdue_paise, risk: c.risk.flag,
          visit: lastVisit.get(c.id) ?? null,
        }));
      // Overdue shops on this salesman's other beats: worth a detour.
      const otherBeatIds = new Set(allBeats.filter((b) => !beatIds.has(b.id)).map((b) => b.id));
      const elsewhere = summaries
        .filter((c) => c.beat_id && otherBeatIds.has(c.beat_id) && c.overdue_paise > 0)
        .sort((a, b) => b.overdue_paise - a.overdue_paise)
        .slice(0, 10)
        .map((c) => ({ id: c.id, name: c.name, area: c.area, overdue_paise: c.overdue_paise, beat_name: beatName.get(c.beat_id!) ?? null }));
      return {
        date,
        weekday,
        salesman: { id: user.id, name: user.name },
        target_paise: user.daily_target_paise,
        collected_paise: collected.rows[0]!.total ?? 0,
        collections: collected.rows[0]!.n,
        beats: todays.map((b) => ({ id: b.id, name: b.name })),
        all_beats: allBeats.map((b) => ({ id: b.id, name: b.name, weekdays: b.weekdays })),
        stops,
        visited: stops.filter((s) => s.visit).length,
        to_collect_paise: stops.reduce((s, c) => s + Math.max(0, c.overdue_paise), 0),
        overdue_elsewhere: elsewhere,
      };
    });
  });

  // ---------- visits ----------
  app.post('/visits', async (req, reply) => {
    const body = z
      .object({
        customer_id: z.string().uuid(),
        outcome: z.enum(VISIT_OUTCOMES),
        note: z.string().trim().max(500).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        accuracy_m: z.number().min(0).max(100_000).optional(),
        client_ref: z.string().uuid().optional(),
        visited_on: isoDate.optional(),
        // Save this location as the shop's location (first visit, or when the salesman confirms it).
        pin_shop: z.boolean().optional(),
      })
      .parse(req.body);
    const today = todayIso(now());
    const day = body.visited_on ?? today;
    if (day > today || day < addDays(today, -7)) throw new HttpError(400, 'Visit date must be within the last 7 days', 'bad_date');
    const result = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      if (body.client_ref) {
        const dup = await tx.query('SELECT id, customer_id, outcome, visited_on FROM visits WHERE client_ref = $1', [body.client_ref]);
        if (dup.rows[0]) return { visit: dup.rows[0], duplicate: true };
      }
      const c = await tx.query<{ lat: number | null }>('SELECT lat FROM customers WHERE id = $1', [body.customer_id]);
      if (!c.rows[0]) throw new HttpError(404, 'Customer not found', 'not_found');
      const res = await tx.query(
        `INSERT INTO visits (tenant_id, customer_id, salesman_id, visited_on, outcome, note, lat, lng, accuracy_m, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, customer_id, outcome, visited_on, created_at`,
        [req.user.tid, body.customer_id, req.user.sub, day, body.outcome, body.note ?? null, body.lat ?? null, body.lng ?? null, body.accuracy_m ?? null, body.client_ref ?? null],
      );
      // Pin the shop on the map from a reasonably accurate GPS fix.
      const goodFix = body.lat !== undefined && body.lng !== undefined && (body.accuracy_m ?? 0) <= 100;
      if (goodFix && (c.rows[0].lat === null || body.pin_shop)) {
        await tx.query('UPDATE customers SET lat = $1, lng = $2 WHERE id = $3', [body.lat, body.lng, body.customer_id]);
      }
      return { visit: res.rows[0], duplicate: false };
    });
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.get('/visits', async (req) => {
    const q = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        salesman_id: z.string().uuid().optional(),
        customer_id: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      })
      .parse(req.query);
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const salesman = req.user.role === 'salesman' ? req.user.sub : q.salesman_id;
      if (salesman) where.push(`v.salesman_id = $${params.push(salesman)}`);
      if (q.customer_id) where.push(`v.customer_id = $${params.push(q.customer_id)}`);
      if (q.from) where.push(`v.visited_on >= $${params.push(q.from)}`);
      if (q.to) where.push(`v.visited_on <= $${params.push(q.to)}`);
      const res = await tx.query(
        `SELECT v.id, v.customer_id, c.name AS customer_name, v.salesman_id, u.name AS salesman_name, v.visited_on, v.outcome, v.note,
                v.lat, v.lng, v.created_at
         FROM visits v JOIN customers c ON c.id = v.customer_id JOIN users u ON u.id = v.salesman_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.created_at DESC LIMIT $${params.push(q.limit)}`,
        params,
      );
      return { visits: res.rows };
    });
  });
}
