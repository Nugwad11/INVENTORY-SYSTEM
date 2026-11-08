import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from './db.js';
import type { AuthUser } from './types.js';

export interface AuditInput {
  storeId: string;
  actor: AuthUser;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export async function appendAudit(tx: Queryable, input: AuditInput): Promise<void> {
  await tx.query('select id from stores where id = $1 for update', [input.storeId]);

  const { rows } = await tx.query<{ hash: string }>(
    'select hash from audit_events where store_id = $1 order by seq desc limit 1',
    [input.storeId],
  );
  const prevHash = rows[0]?.hash ?? '0'.repeat(64);
  const at = new Date().toISOString();
  const payload = {
    at,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
  };
  const hash = createHash('sha256').update(prevHash).update(JSON.stringify(payload)).digest('hex');

  await tx.query(
    `insert into audit_events
       (id, store_id, created_at, actor_id, actor_name, action, entity_type, entity_id,
        summary, before_data, after_data, reason, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      randomUUID(),
      input.storeId,
      at,
      input.actor.id,
      input.actor.name,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reason ?? null,
      prevHash,
      hash,
    ],
  );
}
