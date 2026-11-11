import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { hashToken } from './admin';
import { withTenant } from './tenant';

/**
 * Backend framework: Fastify (decision, Sprint 2.4) - TypeScript first, JSON-schema validation built in, small plugin model,
 * fast enough for Hub sync traffic, plain Node http underneath (works inside the Hub's single executable too).
 */
const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const MAX_EVENTS = 200;

interface IngestEvent { id: string; type: string; branchId: string; payload: unknown; createdAt: string }
declare module 'fastify' { interface FastifyRequest { auth?: { tenantId: string; branchId: string; deviceId: string } } }

export function buildServer(pool: Pool): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, ajv: { customOptions: { removeAdditional: false } } });
  app.get('/health', async () => ({ ok: true }));

  // Device authentication: bearer token -> (tenant, branch, device) through the narrow lookup function. Nothing else is trusted from the request.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const h = req.headers.authorization; const tok = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!tok) return reply.code(401).send({ error: 'unauthorized' });
    const r = await pool.query('SELECT tenant_id, branch_id, device_id FROM op.auth_lookup($1)', [hashToken(tok)]);
    const row = r.rows[0];
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    req.auth = { tenantId: row.tenant_id, branchId: row.branch_id, deviceId: row.device_id };
  });

  /** Hub outbox -> Cloud inbox. Idempotent by event id: duplicates are acknowledged without writing again, so the Hub may safely retry. */
  app.post<{ Body: { events: IngestEvent[] } }>('/v1/ingest', {
    schema: { body: { type: 'object', required: ['events'], additionalProperties: false, properties: { events: { type: 'array', maxItems: MAX_EVENTS, items: { type: 'object', required: ['id', 'type', 'branchId', 'payload', 'createdAt'], additionalProperties: false, properties: { id: { type: 'string', pattern: UUID }, type: { type: 'string', minLength: 1, maxLength: 80 }, branchId: { type: 'string', pattern: UUID }, payload: {}, createdAt: { type: 'string', format: 'date-time' } } } } } } },
  }, async (req, reply) => {
    const a = req.auth!;
    if (req.body.events.some(e => e.branchId !== a.branchId)) return reply.code(403).send({ error: 'branch mismatch' });
    const acked = await withTenant(pool, a.tenantId, async c => {
      const ids: string[] = [];
      for (const e of req.body.events) {
        await c.query('INSERT INTO op.inbox_events(tenant_id,event_id,branch_id,device_id,type,payload,hub_created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, event_id) DO NOTHING',
          [a.tenantId, e.id, a.branchId, a.deviceId, e.type, JSON.stringify(e.payload), e.createdAt]);
        ids.push(e.id);
      }
      return ids;
    });
    return { acked };
  });
  return app;
}
