import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  STATEMENT_LINK_SECRET: z.string().min(32, 'STATEMENT_LINK_SECRET must be at least 32 characters'),
  STATEMENT_LINK_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  WHATSAPP_MODE: z.enum(['console', 'cloud']).default('console'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_REMINDER_TEMPLATE: z.string().default('payment_reminder'),
  WHATSAPP_RECEIPT_TEMPLATE: z.string().default('payment_receipt'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.WHATSAPP_MODE === 'cloud' && (!cfg.WHATSAPP_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error('WHATSAPP_MODE=cloud requires WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  }
  return cfg;
}
