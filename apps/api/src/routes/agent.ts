import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { audit, withSystem, withTenant } from '../db.js';
import { hashAgentKey } from '../domain/password.js';
import { normalisePhone } from '../services/whatsapp.js';

const ledgerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(),
  // Tally closing balance in paise; positive means the customer owes us.
  closing_balance_paise: z.number().int(),
});

/**
 * Endpoints for the on-premise Tally sync agent. Authenticated with an agent
 * key (Bearer clk_...) created by the owner in Settings. Read-only mirror:
 * Tally balances are stored next to the ledger for reconciliation, never
 * posted into it.
 */
export async function agentRoutes(app: FastifyInstance) {
  async function tenantFromKey(req: FastifyRequest): Promise<string> {
    const header = req.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key.startsWith('clk_')) throw new HttpError(401, 'Missing agent key', 'unauthorized');
    const tenantId = await withSystem(app.deps.db, async (tx) => {
      const r = await tx.query<{ tenant_id: string }>(
        'UPDATE agent_keys SET last_used = now() WHERE key_hash = $1 RETURNING tenant_id',
        [hashAgentKey(key)],
      );
      return r.rows[0]?.tenant_id;
    });
    if (!tenantId) throw new HttpError(401, 'Invalid agent key', 'unauthorized');
    return tenantId;
  }

  app.post('/sync/ledgers', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, bodyLimit: 10 * 1_048_576 }, async (req) => {
    const tenantId = await tenantFromKey(req);
    const body = z.object({ ledgers: z.array(ledgerSchema).max(20_000) }).parse(req.body);
    return withTenant(app.deps.db, tenantId, async (tx) => {
      let updated = 0;
      let created = 0;
      const skipped: string[] = [];
      for (const l of body.ledgers) {
        const upd = await tx.query(
          'UPDATE customers SET tally_balance_paise = $1, tally_synced_at = now() WHERE tally_ledger_name = $2',
          [l.closing_balance_paise, l.name],
        );
        if (upd.rowCount) {
          updated++;
          continue;
        }
        const phone = l.phone ? normalisePhone(l.phone) : null;
        if (!phone) {
          skipped.push(l.name);
          continue;
        }
        // Link to an existing customer with the same phone, or create one.
        const link = await tx.query(
          `UPDATE customers SET tally_ledger_name = $1, tally_balance_paise = $2, tally_synced_at = now()
           WHERE phone = $3 AND tally_ledger_name IS NULL`,
          [l.name, l.closing_balance_paise, phone],
        );
        if (link.rowCount) {
          updated++;
          continue;
        }
        const ins = await tx.query(
          `INSERT INTO customers (tenant_id, name, phone, gstin, tally_ledger_name, tally_balance_paise, tally_synced_at)
           VALUES ($1, $2, $3, $4, $2, $5, now()) ON CONFLICT (tenant_id, phone) DO NOTHING`,
          [tenantId, l.name, phone, l.gstin || null, l.closing_balance_paise],
        );
        if (ins.rowCount) created++;
        else skipped.push(l.name);
      }
      await audit(tx, tenantId, 'agent', 'tally.synced', null, { updated, created, skipped: skipped.length });
      return { updated, created, skipped: skipped.length, skipped_names: skipped.slice(0, 50) };
    });
  });
}
