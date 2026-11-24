import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withSystem } from '../db.js';
import { hashPassword, verifyPassword } from '../domain/password.js';

const registerSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// A fixed hash so that unknown emails take the same time as wrong passwords.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/register', strict, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const result = await withSystem(app.deps.db, async (tx) => {
      const tenant = await tx.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [body.businessName]);
      const tenantId = tenant.rows[0]!.id;
      const user = await tx.query<{ id: string }>(
        "INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, 'owner') RETURNING id",
        [tenantId, body.email, passwordHash, body.name],
      );
      await audit(tx, tenantId, `user:${user.rows[0]!.id}`, 'tenant.registered', tenantId);
      return { tenantId, userId: user.rows[0]!.id };
    });
    const token = app.jwt.sign({ sub: result.userId, tid: result.tenantId, role: 'owner', name: body.name });
    return reply.status(201).send({ token, user: { id: result.userId, name: body.name, role: 'owner', tenantId: result.tenantId } });
  });

  app.post('/login', strict, async (req) => {
    const body = loginSchema.parse(req.body);
    const row = await withSystem(app.deps.db, async (tx) => {
      const res = await tx.query<{ id: string; tenant_id: string; password_hash: string; name: string; role: 'owner' | 'accountant' | 'salesman'; active: boolean }>(
        'SELECT id, tenant_id, password_hash, name, role, active FROM users WHERE email = $1',
        [body.email],
      );
      return res.rows[0];
    });
    const ok = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok || !row.active) throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials');
    const token = app.jwt.sign({ sub: row.id, tid: row.tenant_id, role: row.role, name: row.name });
    return { token, user: { id: row.id, name: row.name, role: row.role, tenantId: row.tenant_id } };
  });

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    return { user: { id: req.user.sub, name: req.user.name, role: req.user.role, tenantId: req.user.tid } };
  });
}
