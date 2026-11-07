import { describe, expect, it } from 'vitest';
import type { DemoState } from '../types';
import { recordAudit, verifyAuditChain, type AuditInput } from './audit';

function emptyState(): DemoState {
  return { audit: [] } as unknown as DemoState;
}

const baseInput: AuditInput = {
  actorId: 'usr-owner',
  actorName: 'David Akwu',
  action: 'PO_APPROVED',
  entityType: 'PURCHASE_ORDER',
  entityId: 'po-1',
  summary: 'Approved PO-00001.',
  before: { status: 'PENDING_APPROVAL' },
  after: { status: 'APPROVED' },
  reason: 'Replenishment',
};

describe('audit chain', () => {
  it('links each event to the previous hash starting from GENESIS', () => {
    const state = emptyState();
    const first = recordAudit(state, baseInput);
    const second = recordAudit(state, {
      ...baseInput,
      action: 'SALE_COMPLETED',
      entityType: 'SALE',
      entityId: 'sale-1',
      summary: 'Sale completed.',
    });

    expect(first.prevHash).toBe('GENESIS');
    expect(second.prevHash).toBe(first.hash);
    expect(first.hash).not.toBe(second.hash);
    expect(first.before).toBe(JSON.stringify({ status: 'PENDING_APPROVAL' }));
    expect(first.reason).toBe('Replenishment');
  });

  it('verifies an untouched chain', () => {
    const state = emptyState();
    recordAudit(state, baseInput);
    recordAudit(state, { ...baseInput, entityId: 'po-2' });
    recordAudit(state, { ...baseInput, entityId: 'po-3' });

    expect(verifyAuditChain(state.audit)).toEqual({
      valid: true,
      checked: 3,
      firstBrokenId: null,
    });
  });

  it('detects a tampered event and names the first broken link', () => {
    const state = emptyState();
    const first = recordAudit(state, baseInput);
    const second = recordAudit(state, { ...baseInput, entityId: 'po-2' });
    const third = recordAudit(state, { ...baseInput, entityId: 'po-3' });

    state.audit[1].summary = 'Tampered after the fact';

    const result = verifyAuditChain(state.audit);
    expect(result.valid).toBe(false);
    expect(result.checked).toBe(3);
    expect(result.firstBrokenId).toBe(second.id);
    expect(state.audit[2].prevHash).toBe(second.hash);
    expect(state.audit[0].id).toBe(first.id);
    expect(state.audit[2].id).toBe(third.id);
  });
});
