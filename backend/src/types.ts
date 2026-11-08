export const ROLES = [
  'owner',
  'manager',
  'purchasing',
  'receiving',
  'stock',
  'cashier',
  'auditor',
] as const;

export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  storeId: string;
  name: string;
  role: Role;
}
