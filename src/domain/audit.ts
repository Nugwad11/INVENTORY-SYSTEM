import type { AuditEvent, DemoState } from '../types';
import { uid } from '../lib/id';
import { hashString } from '../lib/format';

export interface AuditInput {
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export function recordAudit(state: DemoState, input: AuditInput): AuditEvent {
  const previous = state.audit[state.audit.length - 1];
  const at = new Date().toISOString();
  const base = {
    id: uid('aud'),
    at,
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    before: input.before === undefined ? null : JSON.stringify(input.before),
    after: input.after === undefined ? null : JSON.stringify(input.after),
    reason: input.reason ?? null,
    prevHash: previous?.hash ?? 'GENESIS',
  };
  const event: AuditEvent = {
    ...base,
    hash: hashString(JSON.stringify(base)),
  };
  state.audit.push(event);
  return event;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBrokenId: string | null;
}

export function verifyAuditChain(audit: AuditEvent[]): ChainVerification {
  let prev = 'GENESIS';
  for (const event of audit) {
    const base = {
      id: event.id,
      at: event.at,
      actorId: event.actorId,
      actorName: event.actorName,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      summary: event.summary,
      before: event.before,
      after: event.after,
      reason: event.reason,
      prevHash: prev,
    };
    const expected = hashString(JSON.stringify(base));
    if (event.prevHash !== prev || event.hash !== expected) {
      return { valid: false, checked: audit.length, firstBrokenId: event.id };
    }
    prev = event.hash;
  }
  return { valid: true, checked: audit.length, firstBrokenId: null };
}
