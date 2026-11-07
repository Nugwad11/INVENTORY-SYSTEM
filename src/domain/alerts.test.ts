import { describe, expect, it } from 'vitest';
import type { Movement } from '../types';
import { createSeedState } from '../data/seed';
import { ACTIVE_ALERT_STATES, markAlert, syncAlerts } from './alerts';

const CONDITION_TYPES = ['OUT_OF_STOCK', 'LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED_STOCK', 'SLOW_MOVING'];

function conditionAlert(types = CONDITION_TYPES) {
  const state = createSeedState();
  syncAlerts(state);
  const alert = state.alerts.find((item) => types.includes(item.type));
  expect(alert, 'seed should produce at least one matching alert').toBeDefined();
  return { state, alert: alert! };
}

describe('alert lifecycle', () => {
  it('keeps one alert per type and entity when synchronisation runs twice', () => {
    const state = createSeedState();
    expect(state.alerts.length).toBeGreaterThan(0);

    const keys = state.alerts.map((alert) => `${alert.type}:${alert.entityId}`);
    expect(new Set(keys).size).toBe(keys.length);

    const before = state.alerts.length;
    syncAlerts(state);
    syncAlerts(state);
    expect(state.alerts.length).toBe(before);
  });

  it('returns a snoozed alert to the queue when the snooze window expires', () => {
    const { state, alert } = conditionAlert();

    markAlert(state, alert.id, 'usr-test', 'Tester', 'snooze', 'Watching the next delivery', -1);
    expect(alert.state).toBe('SNOOZED');

    syncAlerts(state);
    expect(alert.state).toBe('OPEN');
    expect(alert.history.some((entry) => entry.action === 'Snooze expired')).toBe(true);
    expect(ACTIVE_ALERT_STATES).toContain(alert.state);
  });

  it('does not reopen a manually resolved alert while its condition is unchanged', () => {
    const { state, alert } = conditionAlert();

    markAlert(state, alert.id, 'usr-manager', 'Ngozi Okafor', 'resolve', 'Recount confirmed the shelf.', 24);
    expect(alert.state).toBe('RESOLVED');
    expect(alert.dismissUntilClear).toBe(true);

    syncAlerts(state);
    expect(alert.state).toBe('RESOLVED');

    markAlert(state, alert.id, 'usr-manager', 'Ngozi Okafor', 'reopen', 'Condition still visible on the shelf.');
    expect(alert.state).toBe('OPEN');
    expect(alert.dismissUntilClear).toBe(false);
  });

  it('auto-resolves an alert when the underlying stock condition clears', () => {
    const { state, alert } = conditionAlert(['LOW_STOCK', 'OUT_OF_STOCK']);
    const productId = alert.productId!;

    const now = new Date().toISOString();
    state.batches.push({
      id: 'bat-test-fill',
      productId,
      batchNo: 'FILL-001',
      expiry: null,
      receivedAt: now,
      supplierId: null,
    });
    const movement: Movement = {
      id: 'mov-test-fill',
      seq: state.seq + 1,
      transactionId: 'txn-test-fill',
      type: 'RECEIPT',
      productId,
      batchId: 'bat-test-fill',
      qty: 100_000,
      from: null,
      to: { locationId: 'loc-shop', status: 'SELLABLE' },
      unitCost: 10_000,
      value: 1_000_000_000,
      occurredAt: now,
      postedAt: now,
      refType: 'RECEIPT',
      refId: 'rcpt-test',
      actorId: 'usr-test',
      reason: 'Test replenishment',
      note: null,
      sync: 'SYNCED',
    };
    state.seq += 1;
    state.movements.push(movement);

    syncAlerts(state);
    const after = state.alerts.find((item) => item.id === alert.id);
    expect(after?.state).toBe('RESOLVED');
    expect(after?.history.some((entry) => entry.action === 'Auto-resolved')).toBe(true);
  });

  it('assigns ownership and acknowledges in one action', () => {
    const { state, alert } = conditionAlert();

    markAlert(state, alert.id, 'usr-manager', 'Ngozi Okafor', 'assign', 'purchasing');
    expect(alert.ownerRole).toBe('purchasing');
    expect(alert.state).toBe('ACKNOWLEDGED');
    expect(alert.history.some((entry) => entry.action === 'assign')).toBe(true);
  });
});
