import { describe, expect, it } from 'vitest';
import type { Role, User } from '../types';
import { approvalLimitFor, can, canAny, permissionsFor } from './permissions';

function user(role: Role, active = true): User {
  return { id: `usr-${role}`, name: role, role, phone: '+234 800 000 0000', active };
}

describe('role permissions', () => {
  it('denies everything to a missing or deactivated account', () => {
    expect(can(null, 'stock.view')).toBe(false);
    expect(can(user('manager', false), 'stock.view')).toBe(false);
    expect(canAny(user('owner', false), ['admin.users', 'admin.data'])).toBe(false);
  });

  it('gives the owner the full matrix', () => {
    const permissions = permissionsFor('owner');
    expect(permissions).toContain('po.approve');
    expect(permissions).toContain('count.approve');
    expect(permissions).toContain('admin.settings');
    expect(permissions).toContain('report.export');
  });

  it('keeps purchasing out of approval', () => {
    const purchasing = user('purchasing');
    expect(can(purchasing, 'po.create')).toBe(true);
    expect(can(purchasing, 'po.submit')).toBe(true);
    expect(can(purchasing, 'po.approve')).toBe(false);
    expect(can(purchasing, 'writeoff.approve')).toBe(false);
  });

  it('prevents a cashier from seeing cost or approving work', () => {
    const cashier = user('cashier');
    expect(can(cashier, 'sale.create')).toBe(true);
    expect(can(cashier, 'catalog.cost.view')).toBe(false);
    expect(can(cashier, 'stock.cost.view')).toBe(false);
    expect(can(cashier, 'count.approve')).toBe(false);
    expect(can(cashier, 'admin.users')).toBe(false);
  });

  it('keeps the auditor read-only', () => {
    const auditor = user('auditor');
    expect(can(auditor, 'stock.view')).toBe(true);
    expect(can(auditor, 'admin.audit')).toBe(true);
    expect(can(auditor, 'sale.create')).toBe(false);
    expect(can(auditor, 'stock.transfer')).toBe(false);
    expect(can(auditor, 'po.approve')).toBe(false);
  });

  it('lets a stock controller count and request write-offs without approving', () => {
    const stock = user('stock');
    expect(can(stock, 'count.count')).toBe(true);
    expect(can(stock, 'writeoff.create')).toBe(true);
    expect(can(stock, 'count.approve')).toBe(false);
    expect(can(stock, 'writeoff.approve')).toBe(false);
  });
});

describe('approval limits', () => {
  it('maps owner and manager to their configured limits', () => {
    expect(approvalLimitFor('owner', 5_000_000, 50_000_000)).toBe(50_000_000);
    expect(approvalLimitFor('manager', 5_000_000, 50_000_000)).toBe(5_000_000);
  });

  it('gives every other role no approval authority', () => {
    const others: Role[] = ['purchasing', 'receiving', 'stock', 'cashier', 'auditor'];
    others.forEach((role) => {
      expect(approvalLimitFor(role, 5_000_000, 50_000_000)).toBe(0);
    });
  });
});
