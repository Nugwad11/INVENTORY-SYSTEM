import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createGuards } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeSeq: z.coerce.number().int().min(1).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(120).optional(),
});

interface AuditRow {
  seq: string;
  id: string;
  created_at: Date | string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  before_data: unknown;
  after_data: unknown;
  reason: string | null;
  prev_hash: string;
  hash: string;
}

const toIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export function registerAuditRoutes(
  app: FastifyInstance,
  { config, db }: { config: AppConfig; db: Database },
): void {
  const guards = createGuards(db, config);
  const reader = guards.requireRoles('owner', 'manager', 'auditor');

  app.get('/api/audit', { preHandler: [reader] }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const { rows } = await db.query<AuditRow>(
      `select seq::text, id, created_at, actor_id, actor_name, action, entity_type,
              entity_id, summary, before_data, after_data, reason, prev_hash, hash
       from audit_events
       where store_id = $1
         and ($2::bigint is null or seq < $2)
         and ($3::text is null or entity_type = $3)
         and ($4::text is null or entity_id = $4)
       order by seq desc
       limit $5`,
      [
        request.user.storeId,
        query.beforeSeq ?? null,
        query.entityType ?? null,
        query.entityId ?? null,
        query.limit,
      ],
    );

    return {
      events: rows.map((row) => ({
        seq: Number(row.seq),
        id: row.id,
        createdAt: toIso(row.created_at),
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        before: row.before_data,
        after: row.after_data,
        reason: row.reason,
        prevHash: row.prev_hash,
        hash: row.hash,
      })),
    };
  });
}
