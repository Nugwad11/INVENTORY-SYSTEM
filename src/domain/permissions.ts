import type { Role, User } from '../types';

export type Permission =
  | 'catalog.view'
  | 'catalog.manage'
  | 'catalog.cost.view'
  | 'supplier.manage'
  | 'po.create'
  | 'po.submit'
  | 'po.approve'
  | 'po.send'
  | 'receipt.view'
  | 'receipt.manage'
  | 'stock.view'
  | 'stock.adjust'
  | 'stock.transfer'
  | 'stock.status'
  | 'stock.cost.view'
  | 'count.view'
  | 'count.create'
  | 'count.count'
  | 'count.approve'
  | 'sale.view'
  | 'sale.create'
  | 'sale.void'
  | 'sale.return'
  | 'writeoff.create'
  | 'writeoff.approve'
  | 'alert.view'
  | 'alert.manage'
  | 'report.view'
  | 'report.export'
  | 'admin.users'
  | 'admin.settings'
  | 'admin.audit'
  | 'admin.data';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Store manager',
  purchasing: 'Purchasing officer',
  receiving: 'Receiving clerk',
  stock: 'Stock controller',
  cashier: 'Cashier',
  auditor: 'Auditor (read-only)',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full access, policies, approvals, exports and audit.',
  manager: 'Runs the store, approves work within limits, manages queues.',
  purchasing: 'Suppliers, purchase orders and reorder suggestions.',
  receiving: 'Receives goods, captures batches and discrepancy evidence.',
  stock: 'Replenishment, transfers, counts, write-off requests.',
  cashier: 'Records sales, voids and customer returns.',
  auditor: 'Read-only access to documents, movements and audit evidence.',
};

const ALL: Permission[] = [
  'catalog.view', 'catalog.manage', 'catalog.cost.view', 'supplier.manage',
  'po.create', 'po.submit', 'po.approve', 'po.send', 'receipt.view', 'receipt.manage',
  'stock.view', 'stock.adjust', 'stock.transfer', 'stock.status', 'stock.cost.view',
  'count.view', 'count.create', 'count.count', 'count.approve',
  'sale.view', 'sale.create', 'sale.void', 'sale.return',
  'writeoff.create', 'writeoff.approve', 'alert.view', 'alert.manage',
  'report.view', 'report.export', 'admin.users', 'admin.settings', 'admin.audit', 'admin.data',
];

const READ_ONLY: Permission[] = [
  'catalog.view', 'catalog.cost.view', 'receipt.view', 'stock.view', 'stock.cost.view',
  'count.view', 'sale.view', 'alert.view', 'report.view', 'report.export', 'admin.audit',
];

const MATRIX: Record<Role, Permission[]> = {
  owner: ALL,
  manager: [
    'catalog.view', 'catalog.manage', 'catalog.cost.view', 'supplier.manage',
    'po.create', 'po.submit', 'po.approve', 'po.send', 'receipt.view', 'receipt.manage',
    'stock.view', 'stock.adjust', 'stock.transfer', 'stock.status', 'stock.cost.view',
    'count.view', 'count.create', 'count.count', 'count.approve',
    'sale.view', 'sale.create', 'sale.void', 'sale.return',
    'writeoff.create', 'writeoff.approve', 'alert.view', 'alert.manage',
    'report.view', 'report.export', 'admin.users', 'admin.audit',
  ],
  purchasing: [
    'catalog.view', 'catalog.manage', 'catalog.cost.view', 'supplier.manage',
    'po.create', 'po.submit', 'po.send', 'receipt.view', 'stock.view', 'stock.cost.view',
    'alert.view', 'alert.manage', 'report.view', 'report.export',
  ],
  receiving: [
    'catalog.view', 'catalog.cost.view', 'receipt.view', 'receipt.manage',
    'stock.view', 'alert.view', 'report.view',
  ],
  stock: [
    'catalog.view', 'catalog.cost.view', 'stock.view', 'stock.adjust', 'stock.transfer',
    'stock.status', 'stock.cost.view', 'count.view', 'count.create', 'count.count',
    'sale.view', 'writeoff.create', 'alert.view', 'alert.manage', 'report.view', 'report.export',
  ],
  cashier: ['catalog.view', 'stock.view', 'sale.view', 'sale.create', 'sale.void', 'sale.return'],
  auditor: READ_ONLY,
};

export function can(user: User | null | undefined, permission: Permission): boolean {
  if (!user || !user.active) return false;
  return MATRIX[user.role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role];
}

export function canAny(user: User | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

export function approvalLimitFor(role: Role, managerLimit: number, ownerLimit: number): number {
  if (role === 'owner') return ownerLimit;
  if (role === 'manager') return managerLimit;
  return 0;
}
