import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withTenant } from '../db.js';
import { hashPassword, newAgentKey } from '../domain/password.js';
import { isValidVpa } from '../domain/upi.js';
import { rupeesToPaise } from '../domain/money.js';

const tenantPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    upi_vpa: z.string().trim().refine(isValidVpa, 'Enter a valid UPI ID like shop@okhdfc').nullable(),
    upi_payee_name: z.string().trim().min(1).max(50).nullable(),
    wa_phone_number_id: z.string().trim().regex(/^\d{5,30}$/).nullable(),
    gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN').nullable(),
    address: z.string().trim().max(500).nullable(),
    phone: z.string().trim().max(30).nullable(),
    state_code: z.string().trim().regex(/^\d{2}$/, 'State code is 2 digits, e.g. 27 for Maharashtra').nullable(),
    bill_prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9/_-]*$/, 'Use letters, digits, / - _'),
    next_bill_no: z.number().int().min(1).max(100_000_000),
  })
  .partial();

const newUser = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['accountant', 'salesman']),
  password: z.string().min(10).max(200),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const ownerOnly = { preHandler: app.requireRole('owner') };

  app.get('/', async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const t = await tx.query(
        'SELECT id, name, upi_vpa, upi_payee_name, wa_phone_number_id, gstin, address, phone, state_code, bill_prefix, next_bill_no, created_at FROM tenants',
      );
      return { tenant: t.rows[0] };
    });
  });

  app.patch('/', ownerOnly, async (req) => {
    const body = tenantPatch.parse(req.body);
    const keys = Object.keys(body) as Array<keyof typeof body>;
    if (keys.length === 0) throw new HttpError(400, 'Nothing to update', 'empty_update');
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      if (body.gstin && !body.state_code) keys.push('state_code'), (body.state_code = body.gstin.slice(0, 2));
      const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const res = await tx.query(
        `UPDATE tenants SET ${sets} RETURNING id, name, upi_vpa, upi_payee_name, wa_phone_number_id, gstin, address, phone, state_code, bill_prefix, next_bill_no`,
        keys.map((k) => body[k]),
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'tenant.updated', req.user.tid, { fields: keys });
      return { tenant: res.rows[0] };
    });
  });

  app.get('/users', ownerOnly, async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query('SELECT id, name, email, role, active, daily_target_paise, created_at FROM users ORDER BY created_at');
      return { users: res.rows };
    });
  });

  app.post('/users', ownerOnly, async (req, reply) => {
    const body = newUser.parse(req.body);
    const hash = await hashPassword(body.password);
    const user = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        'INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, active',
        [req.user.tid, body.email, hash, body.name, body.role],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'user.created', res.rows[0].id, { role: body.role });
      return res.rows[0];
    });
    return reply.status(201).send({ user });
  });

  app.patch('/users/:id', ownerOnly, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        active: z.boolean().optional(),
        daily_target: z.union([z.number().nonnegative(), z.string()]).transform((v) => rupeesToPaise(v)).optional(),
      })
      .parse(req.body);
    if (body.active === false && id === req.user.sub) throw new HttpError(400, 'You cannot deactivate yourself', 'self_update');
    if (body.active === undefined && body.daily_target === undefined) throw new HttpError(400, 'Nothing to update', 'empty_update');
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        `UPDATE users SET active = coalesce($1, active), daily_target_paise = coalesce($2, daily_target_paise) WHERE id = $3
         RETURNING id, name, email, role, active, daily_target_paise`,
        [body.active ?? null, body.daily_target ?? null, id],
      );
      if (!res.rows[0]) throw new HttpError(404, 'User not found', 'not_found');
      if (body.active !== undefined) await audit(tx, req.user.tid, `user:${req.user.sub}`, body.active ? 'user.activated' : 'user.deactivated', id);
      if (body.daily_target !== undefined) await audit(tx, req.user.tid, `user:${req.user.sub}`, 'user.target_set', id, { daily_target_paise: body.daily_target });
      return { user: res.rows[0] };
    });
  });

  app.get('/agent-keys', ownerOnly, async (req) => {
    return withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query('SELECT id, label, last_used, created_at FROM agent_keys ORDER BY created_at DESC');
      return { keys: res.rows };
    });
  });

  app.post('/agent-keys', ownerOnly, async (req, reply) => {
    const { label } = z.object({ label: z.string().trim().min(1).max(100) }).parse(req.body);
    const { key, hash } = newAgentKey();
    const row = await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query(
        'INSERT INTO agent_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3) RETURNING id, label, created_at',
        [req.user.tid, hash, label],
      );
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'agent_key.created', res.rows[0].id);
      return res.rows[0];
    });
    // The plain key is returned exactly once.
    return reply.status(201).send({ key, ...row });
  });

  app.delete('/agent-keys/:id', ownerOnly, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await withTenant(app.deps.db, req.user.tid, async (tx) => {
      const res = await tx.query('DELETE FROM agent_keys WHERE id = $1', [id]);
      if (!res.rowCount) throw new HttpError(404, 'Key not found', 'not_found');
      await audit(tx, req.user.tid, `user:${req.user.sub}`, 'agent_key.revoked', id);
    });
    return reply.status(204).send();
  });
}
