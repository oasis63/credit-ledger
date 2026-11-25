import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { MessageSender } from './services/whatsapp.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { entryRoutes } from './routes/entries.js';
import { collectionRoutes } from './routes/collections.js';
import { disputeRoutes } from './routes/disputes.js';
import { reminderRoutes } from './routes/reminders.js';
import { reportRoutes } from './routes/reports.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';
import { settingsRoutes } from './routes/settings.js';
import { agentRoutes } from './routes/agent.js';
import { billRoutes } from './routes/bills.js';
import { fieldRoutes } from './routes/field.js';

export type Role = 'owner' | 'accountant' | 'salesman';

export interface AuthUser {
  sub: string; // user id
  tid: string; // tenant id
  role: Role;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  sender: MessageSender;
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.config.NODE_ENV === 'test' ? false : { level: deps.config.LOG_LEVEL, redact: ['req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 1_048_576,
    // Signed statement-link tokens travel as a path parameter.
    routerOptions: { maxParamLength: 600 },
  });

  app.decorate('deps', deps);

  // Keep the raw body for WhatsApp webhook signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new HttpError(400, 'Malformed JSON body', 'bad_json'), undefined);
    }
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: false,
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: deps.config.JWT_SECRET, sign: { expiresIn: '12h' } });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Not signed in', 'unauthorized');
    }
  });

  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'You do not have permission to do this', 'forbidden');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Some fields are invalid',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'conflict', message: 'That record already exists' });
    if (pgCode === '23503') return reply.status(400).send({ error: 'bad_reference', message: 'Referenced record does not exist' });
    if (pgCode === '23514' || pgCode === '22P02') {
      return reply.status(400).send({ error: 'invalid_value', message: 'A value failed validation' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'request_error', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  app.get('/healthz', async () => {
    await deps.db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(customerRoutes, { prefix: '/api/customers' });
  await app.register(entryRoutes, { prefix: '/api' });
  await app.register(collectionRoutes, { prefix: '/api/collections' });
  await app.register(disputeRoutes, { prefix: '/api/disputes' });
  await app.register(reminderRoutes, { prefix: '/api/reminders' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(agentRoutes, { prefix: '/api/agent' });
  await app.register(billRoutes, { prefix: '/api/bills' });
  await app.register(fieldRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  return app;
}
