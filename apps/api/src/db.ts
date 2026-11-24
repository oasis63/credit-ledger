import pg from 'pg';

// BIGINT (int8) comes back as a string by default. Paise amounts stay far
// below Number.MAX_SAFE_INTEGER (~9e15 paise = 90 lakh crore rupees).
pg.types.setTypeParser(20, (v) => Number(v));
// DATE columns: keep as 'YYYY-MM-DD' strings to avoid timezone shifts.
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction scoped to one tenant. The transaction switches to
 * the non-privileged `app_user` role, so Postgres row-level security enforces
 * tenant isolation even if application code forgets a WHERE clause.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error('invalid tenant id');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_user');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Privileged transaction (owner role, RLS bypassed). Use only for cross-tenant paths. */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(
  tx: Tx,
  tenantId: string,
  actor: string,
  action: string,
  subjectId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    'INSERT INTO audit_log (tenant_id, actor, action, subject_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [tenantId, actor, action, subjectId, detail ? JSON.stringify(detail) : null],
  );
}
