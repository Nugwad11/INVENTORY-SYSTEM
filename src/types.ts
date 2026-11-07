export type Role = 'owner' | 'manager' | 'purchasing' | 'receiving' | 'stock' | 'cashier' | 'auditor';

export type StockStatus =
  | 'SELLABLE'
  | 'QUARANTINE'
  | 'DAMAGED'
  | 'EXPIRED'
  | 'RECALL'
  | 'RETURN_PENDING';

export type LocationType = 'SELLING' | 'STORAGE' | 'QUARANTINE' | 'DAMAGED' | 'RETURNS';

export type MovementType =
  | 'OPENING'
  | 'RECEIPT'
  | 'SALE'
  | 'VOID'
  | 'RETURN'
  | 'TRANSFER'
  | 'ADJUSTMENT'
  | 'WRITE_OFF'
  | 'STATUS_CHANGE'
  | 'COUNT';

export type SyncState = 'SYNCED' | 'PENDING';

export type AlertType =
  | 'OUT_OF_STOCK'
  | 'LOW_STOCK'
  | 'NEAR_EXPIRY'
  | 'EXPIRED_STOCK'
  | 'NEGATIVE_STOCK'
  | 'LARGE_VARIANCE'
  | 'SYNC_FAILURE'
  | 'SLOW_MOVING';

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AlertState = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED';

export interface User {
  id: string;
  name: string;
  role: Role;
  phone: string;
  active: boolean;
}

export interface Store {
  id: string;
  name: string;
  code: string;
  timezone: string;
  currency: string;
  address: string;
  tradingDayCutoff: string;
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  sellingAllowed: boolean;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  expiryWarningDays: number;
  color: string;
}

export interface Unit {
  code: 'each' | 'kg' | 'litre' | 'metre';
  label: string;
  precision: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  categoryId: string;
  baseUnit: Unit['code'];
  barcode: string;
  packSize: number;
  packLabel: string;
  cost: number;
  price: number;
  active: boolean;
  weighed: boolean;
  perishable: boolean;
  batchTracked: boolean;
  expiryWarningDays: number;
  reorderPoint: number;
  safetyStock: number;
  reorderMultiple: number;
  supplierId: string;
  defaultLocationId: string;
  isNew?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  leadTimeDays: number;
  reviewDays: number;
  paymentTerms: string;
  minOrder: number;
  active: boolean;
}

export interface Batch {
  id: string;
  productId: string;
  batchNo: string;
  expiry: string | null;
  receivedAt: string;
  supplierId: string | null;
}

export interface MovementEndpoint {
  locationId: string;
  status: StockStatus;
}

export interface Movement {
  id: string;
  seq: number;
  transactionId: string;
  type: MovementType;
  productId: string;
  batchId: string;
  qty: number;
  from: MovementEndpoint | null;
  to: MovementEndpoint | null;
  unitCost: number;
  value: number;
  occurredAt: string;
  postedAt: string;
  refType: 'SALE' | 'RECEIPT' | 'TRANSFER' | 'COUNT' | 'WRITE_OFF' | 'ADJUSTMENT' | 'OPENING' | 'SYSTEM';
  refId: string;
  actorId: string;
  reason: string | null;
  note: string | null;
  sync: SyncState;
}

export type POStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'PART_RECEIVED'
  | 'RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';

export interface POLine {
  id: string;
  productId: string;
  qty: number;
  receivedQty: number;
  unitCost: number;
}

export interface Approval {
  id: string;
  actorId: string;
  actorName: string;
  decision: 'APPROVED' | 'REJECTED';
  comment: string;
  at: string;
  limitSnapshot: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: POStatus;
  lines: POLine[];
  expectedDate: string;
  notes: string;
  version: number;
  createdBy: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  approvals: Approval[];
}

export type ReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'REVERSED';

export interface ReceiptLine {
  id: string;
  productId: string;
  expectedQty: number;
  acceptedQty: number;
  damagedQty: number;
  rejectedQty: number;
  shortQty: number;
  unitCost: number;
  batchNo: string;
  expiry: string | null;
}

export interface Receipt {
  id: string;
  number: string;
  supplierId: string;
  poId: string | null;
  status: ReceiptStatus;
  deliveryNote: string;
  lines: ReceiptLine[];
  createdBy: string;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  sync: SyncState;
  note: string;
}

export type SalePayment = 'CASH' | 'TRANSFER' | 'CREDIT';
export type SaleStatus = 'COMPLETED' | 'VOIDED' | 'PARTIAL_RETURN' | 'RETURNED';

export interface SaleLine {
  id: string;
  productId: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  batchId: string | null;
  returnedQty: number;
}

export interface Sale {
  id: string;
  number: string;
  lines: SaleLine[];
  subtotal: number;
  discount: number;
  total: number;
  payment: SalePayment;
  status: SaleStatus;
  customerName: string | null;
  deviceId: string;
  cashierId: string;
  occurredAt: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  sync: SyncState;
}

export interface Transfer {
  id: string;
  number: string;
  productId: string;
  batchId: string;
  qty: number;
  fromLocationId: string;
  toLocationId: string;
  status: 'POSTED' | 'PENDING_SYNC';
  reason: string;
  actorId: string;
  at: string;
  sync: SyncState;
}

export type CountStatus =
  | 'OPEN'
  | 'SUBMITTED'
  | 'RECOUNT_REQUIRED'
  | 'PENDING_APPROVAL'
  | 'POSTED'
  | 'CANCELLED';

export interface CountEntry {
  id: string;
  productId: string;
  systemQty: number;
  countedQty: number | null;
  recountQty: number | null;
  note: string;
}

export interface StockCount {
  id: string;
  number: string;
  scope: string;
  locationId: string;
  status: CountStatus;
  entries: CountEntry[];
  snapshotSeq: number;
  counterId: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionComment: string | null;
  postedAt: string | null;
  createdAt: string;
}

export interface WriteOff {
  id: string;
  number: string;
  productId: string;
  batchId: string;
  qty: number;
  reason: string;
  note: string;
  unitCost: number;
  value: number;
  status: 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface AlertAction {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  note: string;
  at: string;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  entityType: 'PRODUCT' | 'BATCH' | 'COUNT' | 'SYSTEM';
  entityId: string;
  productId: string | null;
  title: string;
  detail: string;
  value: number;
  state: AlertState;
  ownerRole: Role;
  detectedAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  history: AlertAction[];
  dismissUntilClear: boolean;
  conditionSeen: boolean;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  prevHash: string;
  hash: string;
}

export interface Settings {
  approvalLimitManager: number;
  approvalLimitOwner: number;
  receiptTolerancePct: number;
  negativeStockAllowed: boolean;
  countVarianceThreshold: number;
  lowStockWindowDays: number;
  expiryWarningDays: number;
  largeText: boolean;
  compactMode: boolean;
  autoLockDays: number;
}

export interface DemoState {
  version: number;
  store: Store;
  locations: Location[];
  categories: Category[];
  suppliers: Supplier[];
  products: Product[];
  batches: Batch[];
  movements: Movement[];
  purchaseOrders: PurchaseOrder[];
  receipts: Receipt[];
  sales: Sale[];
  transfers: Transfer[];
  counts: StockCount[];
  writeOffs: WriteOff[];
  alerts: Alert[];
  users: User[];
  currentUserId: string;
  settings: Settings;
  audit: AuditEvent[];
  seq: number;
  counters: Record<string, number>;
  lastSyncAt: string;
  deviceId: string;
  seededAt: string;
}
