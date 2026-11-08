import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Alert,
  AuditEvent,
  Batch,
  DemoState,
  Movement,
  MovementType,
  Product,
  PurchaseOrder,
  Receipt,
  ReceiptLine,
  Role,
  Sale,
  SalePayment,
  Settings,
  StockStatus,
  SyncState,
  User,
} from '../types';
import { createSeedState } from '../data/seed';
import { can, approvalLimitFor, type Permission } from '../domain/permissions';
import {
  allocateFefo,
  averageCostAfterReceipt,
  computeStock,
  computeStockValue,
  onOrderForProduct,
  reorderSuggestion,
  roundQty,
  stockFor,
  type ProductStock,
  type ReorderSuggestion,
  type StockValueSummary,
} from '../domain/inventory';
import { recordAudit } from '../domain/audit';
import { ACTIVE_ALERT_STATES, markAlert, raiseVarianceAlert, syncAlerts } from '../domain/alerts';
import { docNumber, uid } from '../lib/id';

const STORAGE_KEY = 'storehouse.demo.v1';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTemporaryPassword(length = 10): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join('');
}

async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ToastMessage {
  id: string;
  message: string;
  kind: 'success' | 'error' | 'info';
}

type Mutation = (draft: DemoState) => void;

interface SaleInput {
  lines: { productId: string; qty: number }[];
  payment: SalePayment;
  discount: number;
  customerName: string;
}

interface ReturnSelection {
  lineId: string;
  qty: number;
  disposition: 'SELLABLE' | 'DAMAGED' | 'QUARANTINE';
}

interface NewProductInput {
  name: string;
  sku: string;
  brand: string;
  categoryId: string;
  baseUnit: Product['baseUnit'];
  barcode: string;
  packSize: number;
  packLabel: string;
  cost: number;
  price: number;
  weighed: boolean;
  perishable: boolean;
  batchTracked: boolean;
  expiryWarningDays: number;
  reorderPoint: number;
  safetyStock: number;
  reorderMultiple: number;
  supplierId: string;
  defaultLocationId: string;
}

interface AppActions {
  saveProduct: (input: NewProductInput, productId?: string) => boolean;
  toggleProduct: (productId: string) => void;
  updateProductPrice: (productId: string, price: number, reason: string) => boolean;
  createSale: (input: SaleInput) => Sale | null;
  voidSale: (saleId: string, reason: string) => boolean;
  returnSale: (saleId: string, selections: ReturnSelection[], reason: string) => boolean;
  createPurchaseOrder: (input: {
    supplierId: string;
    expectedDate: string;
    notes: string;
    lines: { productId: string; qty: number; unitCost: number }[];
  }) => string | null;
  submitPurchaseOrder: (poId: string) => void;
  approvePurchaseOrder: (poId: string, comment: string) => boolean;
  rejectPurchaseOrder: (poId: string, comment: string) => boolean;
  sendPurchaseOrder: (poId: string) => void;
  cancelPurchaseOrder: (poId: string, reason: string) => void;
  closeShort: (poId: string, reason: string) => void;
  createReceiptDraft: (poId: string) => string | null;
  saveReceiptDraft: (receipt: Receipt) => void;
  confirmReceipt: (receiptId: string, draft?: Receipt) => boolean;
  reverseReceipt: (receiptId: string) => boolean;
  createTransfer: (input: {
    productId: string;
    batchId: string;
    qty: number;
    fromLocationId: string;
    toLocationId: string;
    reason: string;
  }) => boolean;
  changeBatchStatus: (input: {
    productId: string;
    batchId: string;
    qty: number;
    locationId: string;
    fromStatus: StockStatus;
    toStatus: StockStatus;
    reason: string;
  }) => boolean;
  requestWriteOff: (input: {
    productId: string;
    batchId: string;
    qty: number;
    reason: string;
    note: string;
  }) => boolean;
  approveWriteOff: (writeOffId: string, note: string) => boolean;
  rejectWriteOff: (writeOffId: string, note: string) => void;
  createCount: (scope: string, locationId: string, productIds: string[]) => string | null;
  saveCountEntries: (countId: string, entries: { id: string; countedQty: number | null; note: string }[]) => void;
  submitCount: (countId: string, entries?: { id: string; countedQty: number | null; note: string }[]) => boolean;
  saveRecount: (countId: string, entries: { id: string; recountQty: number | null }[]) => void;
  approveCount: (countId: string, comment: string) => boolean;
  rejectCount: (countId: string, comment: string) => void;
  cancelCount: (countId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addUser: (input: { name: string; role: Role; phone: string }) => boolean;
  updateUser: (userId: string, input: { name: string; role: Role; phone: string }) => boolean;
  resetUserPassword: (userId: string) => Promise<{ password: string; resetAt: string } | null>;
  deleteUser: (userId: string) => boolean;
  toggleUser: (userId: string) => void;
  switchUser: (userId: string) => void;
  signInServerUser: (user: { id: string; name: string; role: Role; phone: string }) => void;
  markAlertAction: (
    alertId: string,
    action: 'acknowledge' | 'snooze' | 'resolve' | 'reopen' | 'assign',
    note?: string,
    snoozeHours?: number,
  ) => void;
  syncNow: () => void;
  resetDemo: () => void;
  importState: (json: string) => boolean;
  toast: (message: string, kind?: ToastMessage['kind']) => void;
  canDo: (permission: Permission) => boolean;
}

interface AppContextValue {
  state: DemoState;
  currentUser: User;
  stockMap: Map<string, ProductStock>;
  stockValue: StockValueSummary;
  alerts: Alert[];
  activeAlerts: Alert[];
  reorder: ReorderSuggestion[];
  pendingSyncCount: number;
  online: boolean;
  simulateOffline: boolean;
  setSimulateOffline: (v: boolean) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

function loadState(): DemoState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.products)) return null;
    if (!Array.isArray(parsed.alerts)) parsed.alerts = [];
    return parsed;
  } catch {
    return null;
  }
}

function persist(state: DemoState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable in private windows; the session still works in memory.
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => loadState() ?? createSeedState());
  const [simulateOffline, setSimulateOfflineState] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const online = browserOnline && !simulateOffline;
  const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? state.users[0];

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    persist(state);
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', state.settings.largeText);
    document.documentElement.classList.toggle('compact', state.settings.compactMode);
  }, [state.settings.largeText, state.settings.compactMode]);

  const toast = useCallback((message: string, kind: ToastMessage['kind'] = 'success') => {
    const id = uid('toast');
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    toastTimers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete toastTimers.current[id];
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (toastTimers.current[id]) {
      clearTimeout(toastTimers.current[id]);
      delete toastTimers.current[id];
    }
  }, []);

  const requirePerm = useCallback(
    (permission: Permission): boolean => {
      if (can(currentUser, permission)) return true;
      toast('Your role does not allow this action.', 'error');
      return false;
    },
    [currentUser, toast],
  );

  const commit = useCallback((recipe: Mutation) => {
    setState((prev) => {
      const draft = structuredClone(prev);
      recipe(draft);
      syncAlerts(draft);
      return draft;
    });
  }, []);

  const stockMap = useMemo(() => computeStock(state), [state]);
  const stockValue = useMemo(() => computeStockValue(state, stockMap), [state, stockMap]);
  const pendingSyncCount = useMemo(() => {
    let count = 0;
    const seen = new Set<string>();
    for (const movement of state.movements) {
      if (movement.sync === 'PENDING' && !seen.has(movement.transactionId)) {
        seen.add(movement.transactionId);
        count += 1;
      }
    }
    for (const sale of state.sales) if (sale.sync === 'PENDING' && !seen.has(sale.id)) count += 1;
    for (const receipt of state.receipts) if (receipt.sync === 'PENDING' && !seen.has(receipt.id)) count += 1;
    return count;
  }, [state]);
  const alerts = useMemo(
    () => [...state.alerts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.alerts],
  );
  const activeAlerts = useMemo(() => alerts.filter((a) => ACTIVE_ALERT_STATES.includes(a.state)), [alerts]);

  const reorder = useMemo(
    () =>
      state.products
        .filter((p) => p.active)
        .map((product) => reorderSuggestion(state, product, stockFor(stockMap, product.id)))
        .sort((a, b) => {
          const rank = { OUT: 0, LOW: 1, OK: 2 };
          return rank[a.status] - rank[b.status] || b.need - a.need;
        }),
    [state, stockMap],
  );

  const canDo = useCallback((permission: Permission) => can(currentUser, permission), [currentUser]);

  const actor = useMemo(
    () => ({ id: currentUser.id, name: currentUser.name }),
    [currentUser],
  );

  const syncState = (): SyncState => (online ? 'SYNCED' : 'PENDING');

  const addMovement = useCallback(
    (
      draft: DemoState,
      input: {
        type: MovementType;
        productId: string;
        batchId: string;
        qty: number;
        from: { locationId: string; status: StockStatus } | null;
        to: { locationId: string; status: StockStatus } | null;
        unitCost: number;
        occurredAt: string;
        refType: Movement['refType'];
        refId: string;
        reason: string | null;
        note: string | null;
        transactionId?: string;
      },
    ): Movement => {
      const movement: Movement = {
        id: uid('mov'),
        seq: draft.seq + 1,
        transactionId: input.transactionId ?? uid('txn'),
        type: input.type,
        productId: input.productId,
        batchId: input.batchId,
        qty: roundQty(input.qty),
        from: input.from,
        to: input.to,
        unitCost: input.unitCost,
        value: Math.round(input.qty * input.unitCost),
        occurredAt: input.occurredAt,
        postedAt: new Date().toISOString(),
        refType: input.refType,
        refId: input.refId,
        actorId: currentUser.id,
        reason: input.reason,
        note: input.note,
        sync: syncState(),
      };
      draft.seq += 1;
      draft.movements.push(movement);
      return movement;
    },
    [currentUser.id, online],
  );

  const nextNumber = (draft: DemoState, key: string, prefix: string): string => {
    const next = (draft.counters[key] ?? 0) + 1;
    draft.counters[key] = next;
    return docNumber(prefix, next);
  };

  const productById = (draft: DemoState, id: string) => draft.products.find((p) => p.id === id);
  const batchById = (draft: DemoState, id: string) => draft.batches.find((b) => b.id === id);

  const audit = (
    draft: DemoState,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    before?: unknown,
    after?: unknown,
    reason?: string,
  ) =>
    recordAudit(draft, {
      actorId: actor.id,
      actorName: actor.name,
      action,
      entityType,
      entityId,
      summary,
      before,
      after,
      reason,
    });

  const actions = useMemo<AppActions>(() => {
    const switchUser = (userId: string) => {
      const user = state.users.find((u) => u.id === userId);
      if (!user || !user.active) {
        toast('That account is deactivated.', 'error');
        return;
      }
      commit((draft) => {
        draft.currentUserId = userId;
        recordAudit(draft, {
          actorId: userId,
          actorName: user.name,
          action: 'SESSION_START',
          entityType: 'USER',
          entityId: userId,
          summary: `Switched demo session to ${user.name} (${user.role}).`,
        });
      });
      toast(`Now acting as ${user.name}`);
    };

    const signInServerUser = (serverUser: { id: string; name: string; role: Role; phone: string }) => {
      const existing = state.users.find((u) => u.id === serverUser.id);
      const unchanged =
        state.currentUserId === serverUser.id &&
        existing?.name === serverUser.name &&
        existing.role === serverUser.role &&
        existing.phone === serverUser.phone &&
        existing.active;
      if (unchanged) return;

      commit((draft) => {
        const target = draft.users.find((u) => u.id === serverUser.id);
        if (target) {
          target.name = serverUser.name;
          target.role = serverUser.role;
          target.phone = serverUser.phone;
          target.active = true;
          target.passwordHash = undefined;
          target.passwordUpdatedAt = undefined;
        } else {
          draft.users.push({
            id: serverUser.id,
            name: serverUser.name,
            role: serverUser.role,
            phone: serverUser.phone,
            active: true,
          });
        }
        draft.currentUserId = serverUser.id;
      });
    };

    const saveProduct = (input: NewProductInput, productId?: string): boolean => {
      if (!requirePerm('catalog.manage')) return false;
      if (!input.name.trim() || !input.sku.trim()) {
        toast('Name and SKU are required.', 'error');
        return false;
      }
      const duplicateSku = state.products.find(
        (p) => p.sku.toLowerCase() === input.sku.trim().toLowerCase() && p.id !== productId,
      );
      if (duplicateSku) {
        toast(`SKU ${input.sku} is already used by ${duplicateSku.name}.`, 'error');
        return false;
      }
      const duplicateBarcode =
        input.barcode.trim() &&
        state.products.find(
          (p) => p.barcode === input.barcode.trim() && p.id !== productId,
        );
      if (duplicateBarcode) {
        toast(`Barcode already maps to ${duplicateBarcode.name}.`, 'error');
        return false;
      }

      if (productId) {
        const existing = state.products.find((p) => p.id === productId);
        if (!existing) return false;
        if (existing.baseUnit !== input.baseUnit) {
          const hasHistory = state.movements.some((m) => m.productId === productId);
          if (hasHistory) {
            toast('Base unit cannot change after stock history exists.', 'error');
            return false;
          }
        }
        commit((draft) => {
          const product = productById(draft, productId);
          if (!product) return;
          const before = { ...product };
          Object.assign(product, {
            ...input,
            sku: input.sku.trim(),
            name: input.name.trim(),
            barcode: input.barcode.trim(),
            active: product.active,
          });
          audit(draft, 'PRODUCT_UPDATED', 'PRODUCT', productId, `Updated ${product.name} (${product.sku}).`, before, product);
        });
        toast('Product updated.');
        return true;
      }

      const id = uid('prd');
      commit((draft) => {
        const product: Product = {
          ...input,
          id,
          sku: input.sku.trim(),
          name: input.name.trim(),
          barcode: input.barcode.trim(),
          active: true,
          isNew: true,
        };
        draft.products.push(product);
        audit(draft, 'PRODUCT_CREATED', 'PRODUCT', id, `Created ${product.name} (${product.sku}).`, undefined, product);
      });
      toast('Product created.');
      return true;
    };

    const toggleProduct = (productId: string) => {
      if (!requirePerm('catalog.manage')) return;
      const product = productById(state, productId);
      if (!product) return;
      commit((draft) => {
        const target = productById(draft, productId);
        if (!target) return;
        target.active = !target.active;
        audit(
          draft,
          target.active ? 'PRODUCT_REACTIVATED' : 'PRODUCT_DEACTIVATED',
          'PRODUCT',
          productId,
          `${target.active ? 'Reactivated' : 'Deactivated'} ${target.name}.`,
          { active: !target.active },
          { active: target.active },
        );
      });
      toast(product.active ? 'Product deactivated.' : 'Product reactivated.');
    };

    const updateProductPrice = (productId: string, price: number, reason: string): boolean => {
      if (!requirePerm('catalog.manage')) return false;
      if (!Number.isFinite(price) || price <= 0) {
        toast('Enter a valid selling price.', 'error');
        return false;
      }
      const product = productById(state, productId);
      if (!product) return false;
      if (!reason.trim()) {
        toast('A reason is required for a price change.', 'error');
        return false;
      }
      commit((draft) => {
        const target = productById(draft, productId);
        if (!target) return;
        const before = target.price;
        target.price = Math.round(price);
        audit(
          draft,
          'PRICE_CHANGED',
          'PRODUCT',
          productId,
          `Selling price for ${target.name} changed by ${Math.round((target.price - before) / 100)} naira.`,
          { price: before },
          { price: target.price },
          reason,
        );
      });
      toast('Price updated and versioned in the audit trail.');
      return true;
    };

    const createSale = (input: SaleInput): Sale | null => {
      if (!requirePerm('sale.create')) return null;
      if (!input.lines.length) {
        toast('Add at least one product to the sale.', 'error');
        return null;
      }
      if (input.lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
        toast('Every line needs a quantity greater than zero.', 'error');
        return null;
      }
      const stocks = computeStock(state);
      const saleId = uid('sale');
      const number = docNumber('SALE', (state.counters.SALE ?? 0) + 1);
      const lines: Sale['lines'] = [];
      const allocationsByProduct: { productId: string; batchId: string; qty: number }[] = [];
      let subtotal = 0;

      const quantities = new Map<string, number>();
      input.lines.forEach((line) => {
        quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.qty);
      });

      for (const [productId, requestedQty] of quantities) {
        const product = productById(state, productId);
        if (!product || !product.active) {
          toast('One of the products is unavailable.', 'error');
          return null;
        }
        const stock = stockFor(stocks, product.id);
        const { allocations, shortfall } = allocateFefo(stock, 'loc-shop', requestedQty);
        if (shortfall > 0.0005) {
          toast(
            `${product.name}: only ${roundQty(requestedQty - shortfall)} ${product.baseUnit} sellable on the shop floor.`,
            'error',
          );
          return null;
        }
        for (const allocation of allocations) {
          lines.push({
            id: uid('sln'),
            productId: product.id,
            qty: allocation.qty,
            unitPrice: product.price,
            unitCost: product.cost,
            batchId: allocation.batchId,
            returnedQty: 0,
          });
          allocationsByProduct.push({ productId: product.id, ...allocation });
          subtotal += Math.round(allocation.qty * product.price);
        }
      }

      const discount = Math.min(Math.max(0, Math.round(input.discount)), subtotal);
      const total = subtotal - discount;
      if (total < 0) {
        toast('Discount cannot exceed the sale total.', 'error');
        return null;
      }

      let createdSale: Sale | null = null;
      commit((draft) => {
        const occurredAt = new Date().toISOString();
        allocationsByProduct.forEach((allocation) => {
          const product = productById(draft, allocation.productId);
          if (!product) return;
          addMovement(draft, {
            type: 'SALE',
            productId: allocation.productId,
            batchId: allocation.batchId,
            qty: allocation.qty,
            from: { locationId: 'loc-shop', status: 'SELLABLE' },
            to: null,
            unitCost: product.cost,
            occurredAt,
            refType: 'SALE',
            refId: saleId,
            reason: 'POS sale',
            note: number,
            transactionId: saleId,
          });
        });
        const sale: Sale = {
          id: saleId,
          number,
          lines,
          subtotal,
          discount,
          total,
          payment: input.payment,
          status: 'COMPLETED',
          customerName: input.customerName.trim() || null,
          deviceId: draft.deviceId,
          cashierId: currentUser.id,
          occurredAt,
          createdAt: occurredAt,
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
          sync: syncState(),
        };
        draft.sales.unshift(sale);
        draft.counters.SALE = (draft.counters.SALE ?? 0) + 1;
        createdSale = sale;
        audit(
          draft,
          'SALE_COMPLETED',
          'SALE',
          saleId,
          `${number} recorded · ${lines.length} line(s) · total ${(total / 100).toLocaleString('en-NG')} naira.`,
          undefined,
          { total, payment: input.payment },
        );
      });
      toast(`Sale ${number} recorded.`);
      return createdSale;
    };

    const voidSale = (saleId: string, reason: string): boolean => {
      if (!requirePerm('sale.void')) return false;
      const sale = state.sales.find((s) => s.id === saleId);
      if (!sale) return false;
      if (sale.status === 'VOIDED') {
        toast('This sale is already voided.', 'error');
        return false;
      }
      if (!reason.trim()) {
        toast('Void reason is required.', 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.sales.find((s) => s.id === saleId);
        if (!target) return;
        const at = new Date().toISOString();
        target.lines.forEach((line) => {
          const qty = roundQty(line.qty - line.returnedQty);
          if (qty <= 0 || !line.batchId) return;
          addMovement(draft, {
            type: 'VOID',
            productId: line.productId,
            batchId: line.batchId,
            qty,
            from: null,
            to: { locationId: 'loc-shop', status: 'SELLABLE' },
            unitCost: line.unitCost,
            occurredAt: at,
            refType: 'SALE',
            refId: target.id,
            reason: 'Sale void',
            note: target.number,
            transactionId: target.id,
          });
        });
        target.status = 'VOIDED';
        target.voidedAt = at;
        target.voidedBy = currentUser.id;
        target.voidReason = reason;
        audit(
          draft,
          'SALE_VOIDED',
          'SALE',
          saleId,
          `Voided ${target.number} and restored stock to the shop floor.`,
          { status: 'COMPLETED' },
          { status: 'VOIDED' },
          reason,
        );
      });
      toast(`Sale ${sale.number} voided.`);
      return true;
    };

    const returnSale = (saleId: string, selections: ReturnSelection[], reason: string): boolean => {
      if (!requirePerm('sale.return')) return false;
      const sale = state.sales.find((s) => s.id === saleId);
      if (!sale || sale.status === 'VOIDED') {
        toast('That sale cannot be returned.', 'error');
        return false;
      }
      if (!reason.trim()) {
        toast('Return reason is required.', 'error');
        return false;
      }
      for (const selection of selections) {
        const line = sale.lines.find((l) => l.id === selection.lineId);
        if (!line) continue;
        const remaining = line.qty - line.returnedQty;
        if (selection.qty < 0 || selection.qty > remaining + 0.0005) {
          toast('Return quantity exceeds what remains on the line.', 'error');
          return false;
        }
      }
      const activeSelections = selections.filter((s) => s.qty > 0.0005);
      if (!activeSelections.length) {
        toast('Choose at least one line to return.', 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.sales.find((s) => s.id === saleId);
        if (!target) return;
        const at = new Date().toISOString();
        activeSelections.forEach((selection) => {
          const line = target.lines.find((l) => l.id === selection.lineId);
          if (!line || !line.batchId) return;
          const destination =
            selection.disposition === 'SELLABLE'
              ? { locationId: 'loc-shop', status: 'SELLABLE' as StockStatus }
              : selection.disposition === 'DAMAGED'
                ? { locationId: 'loc-damaged', status: 'DAMAGED' as StockStatus }
                : { locationId: 'loc-quarantine', status: 'QUARANTINE' as StockStatus };
          addMovement(draft, {
            type: 'RETURN',
            productId: line.productId,
            batchId: line.batchId,
            qty: selection.qty,
            from: null,
            to: destination,
            unitCost: line.unitCost,
            occurredAt: at,
            refType: 'SALE',
            refId: target.id,
            reason: `Customer return — ${selection.disposition.toLowerCase()}`,
            note: target.number,
            transactionId: target.id,
          });
          line.returnedQty = roundQty(line.returnedQty + selection.qty);
        });
        const allReturned = target.lines.every((l) => l.returnedQty >= l.qty - 0.0005);
        target.status = allReturned ? 'RETURNED' : 'PARTIAL_RETURN';
        audit(
          draft,
          'SALE_RETURNED',
          'SALE',
          saleId,
          `Return recorded against ${target.number} (${activeSelections.reduce((s, x) => s + x.qty, 0)} unit(s)).`,
          undefined,
          { status: target.status },
          reason,
        );
      });
      toast('Return recorded and stock updated.');
      return true;
    };

    const createPurchaseOrder: AppActions['createPurchaseOrder'] = (input) => {
      if (!requirePerm('po.create')) return null;
      if (!input.lines.length) {
        toast('Add at least one line to the purchase order.', 'error');
        return null;
      }
      if (input.lines.some((l) => l.qty <= 0 || l.unitCost <= 0)) {
        toast('Quantities and unit costs must be greater than zero.', 'error');
        return null;
      }
      const id = uid('po');
      const number = docNumber('PO', (state.counters.PO ?? 0) + 1);
      commit((draft) => {
        const po: PurchaseOrder = {
          id,
          number,
          supplierId: input.supplierId,
          status: 'DRAFT',
          lines: input.lines.map((line) => ({
            id: uid('pol'),
            productId: line.productId,
            qty: roundQty(line.qty),
            receivedQty: 0,
            unitCost: Math.round(line.unitCost),
          })),
          expectedDate: input.expectedDate,
          notes: input.notes,
          version: 1,
          createdBy: currentUser.id,
          createdAt: new Date().toISOString(),
          submittedAt: null,
          approvedAt: null,
          sentAt: null,
          closedAt: null,
          closeReason: null,
          approvals: [],
        };
        draft.purchaseOrders.unshift(po);
        draft.counters.PO = (draft.counters.PO ?? 0) + 1;
        audit(draft, 'PO_CREATED', 'PURCHASE_ORDER', id, `Created ${number} (draft).`);
      });
      toast(`Purchase order ${number} saved as draft.`);
      return id;
    };

    const changePoStatus = (
      poId: string,
      allowedFrom: PurchaseOrder['status'][],
      to: PurchaseOrder['status'],
      action: string,
      summary: string,
      recipe?: (po: PurchaseOrder) => void,
    ): boolean => {
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po) return false;
      if (!allowedFrom.includes(po.status)) {
        toast(`This purchase order is ${po.status.toLowerCase().replace('_', ' ')}.`, 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.purchaseOrders.find((p) => p.id === poId);
        if (!target) return;
        const before = target.status;
        target.status = to;
        if (to === 'PENDING_APPROVAL') target.submittedAt = new Date().toISOString();
        if (to === 'SENT') target.sentAt = new Date().toISOString();
        if (to === 'CANCELLED' || to === 'CLOSED') target.closedAt = new Date().toISOString();
        recipe?.(target);
        audit(draft, action, 'PURCHASE_ORDER', poId, summary, { status: before }, { status: target.status });
      });
      toast(summary);
      return true;
    };

    const submitPurchaseOrder = (poId: string) => {
      if (!requirePerm('po.submit')) return;
      const po = state.purchaseOrders.find((p) => p.id === poId);
      changePoStatus(
        poId,
        ['DRAFT'],
        'PENDING_APPROVAL',
        'PO_SUBMITTED',
        `${po?.number ?? 'Purchase order'} submitted for approval.`,
      );
    };

    const approvePurchaseOrder = (poId: string, comment: string): boolean => {
      if (!requirePerm('po.approve')) return false;
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po) return false;
      if (po.createdBy === currentUser.id) {
        toast('You cannot approve a purchase order you created.', 'error');
        return false;
      }
      if (po.status !== 'PENDING_APPROVAL') {
        toast('Only submitted purchase orders can be approved.', 'error');
        return false;
      }
      const total = po.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
      const limit = approvalLimitFor(
        currentUser.role,
        state.settings.approvalLimitManager,
        state.settings.approvalLimitOwner,
      );
      if (total > limit) {
        toast(
          `Approval limit exceeded: this order is ${(total / 100).toLocaleString('en-NG')} naira and your limit is ${(limit / 100).toLocaleString('en-NG')}. The owner must approve.`,
          'error',
        );
        return false;
      }
      commit((draft) => {
        const target = draft.purchaseOrders.find((p) => p.id === poId);
        if (!target) return;
        target.approvals.push({
          id: uid('apr'),
          actorId: currentUser.id,
          actorName: currentUser.name,
          decision: 'APPROVED',
          comment,
          at: new Date().toISOString(),
          limitSnapshot: limit,
        });
        target.status = 'APPROVED';
        target.approvedAt = new Date().toISOString();
        audit(
          draft,
          'PO_APPROVED',
          'PURCHASE_ORDER',
          poId,
          `Approved ${target.number}.`,
          { status: 'PENDING_APPROVAL' },
          { status: 'APPROVED' },
          comment,
        );
      });
      toast(`${po.number} approved.`);
      return true;
    };

    const rejectPurchaseOrder = (poId: string, comment: string): boolean => {
      if (!requirePerm('po.approve')) return false;
      if (!comment.trim()) {
        toast('A comment is required when rejecting.', 'error');
        return false;
      }
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po || po.status !== 'PENDING_APPROVAL') return false;
      commit((draft) => {
        const target = draft.purchaseOrders.find((p) => p.id === poId);
        if (!target) return;
        target.approvals.push({
          id: uid('apr'),
          actorId: currentUser.id,
          actorName: currentUser.name,
          decision: 'REJECTED',
          comment,
          at: new Date().toISOString(),
          limitSnapshot: 0,
        });
        target.status = 'DRAFT';
        audit(
          draft,
          'PO_REJECTED',
          'PURCHASE_ORDER',
          poId,
          `Rejected ${target.number} and returned it to draft.`,
          { status: 'PENDING_APPROVAL' },
          { status: 'DRAFT' },
          comment,
        );
      });
      toast(`${po.number} rejected and returned to draft.`);
      return true;
    };

    const sendPurchaseOrder = (poId: string) => {
      if (!requirePerm('po.send')) return;
      const po = state.purchaseOrders.find((p) => p.id === poId);
      changePoStatus(
        poId,
        ['APPROVED'],
        'SENT',
        'PO_SENT',
        `${po?.number ?? 'Purchase order'} issued to the supplier.`,
      );
    };

    const cancelPurchaseOrder = (poId: string, reason: string) => {
      if (!requirePerm('po.create')) return;
      if (!reason.trim()) {
        toast('A cancellation reason is required.', 'error');
        return;
      }
      changePoStatus(poId, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'], 'CANCELLED', 'PO_CANCELLED', 'Purchase order cancelled.', (target) => {
        target.closeReason = reason;
      });
    };

    const closeShort = (poId: string, reason: string) => {
      if (!requirePerm('po.approve')) return;
      if (!reason.trim()) {
        toast('A close-short reason is required.', 'error');
        return;
      }
      changePoStatus(poId, ['PART_RECEIVED', 'SENT'], 'CLOSED', 'PO_CLOSED_SHORT', 'Purchase order closed short.', (target) => {
        target.closeReason = reason;
      });
    };

    const createReceiptDraft = (poId: string): string | null => {
      if (!requirePerm('receipt.manage')) return null;
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po) return null;
      if (!['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status)) {
        toast('Receipts can only be created against an approved or sent order.', 'error');
        return null;
      }
      const receiptId = uid('rcpt');
      const number = docNumber('GRN', (state.counters.RECEIPT ?? 0) + 1);
      const outstanding = po.lines.filter((line) => line.qty - line.receivedQty > 0.0005);
      if (!outstanding.length) {
        toast('This purchase order is fully received.', 'error');
        return null;
      }
      commit((draft) => {
        const receipt: Receipt = {
          id: receiptId,
          number,
          supplierId: po.supplierId,
          poId,
          status: 'DRAFT',
          deliveryNote: '',
          lines: outstanding.map((line) => {
            const product = productById(draft, line.productId);
            return {
              id: uid('rcl'),
              productId: line.productId,
              expectedQty: roundQty(line.qty - line.receivedQty),
              acceptedQty: roundQty(line.qty - line.receivedQty),
              damagedQty: 0,
              rejectedQty: 0,
              shortQty: 0,
              unitCost: line.unitCost,
              batchNo: `${product?.sku ?? 'LOT'}-${new Date().toISOString().slice(2, 7).replace('-', '')}`,
              expiry: null,
            };
          }),
          createdBy: currentUser.id,
          createdAt: new Date().toISOString(),
          confirmedAt: null,
          confirmedBy: null,
          sync: syncState(),
          note: '',
        };
        draft.receipts.unshift(receipt);
        draft.counters.RECEIPT = (draft.counters.RECEIPT ?? 0) + 1;
        audit(draft, 'RECEIPT_DRAFT_CREATED', 'RECEIPT', receiptId, `Started ${number} against ${po.number}.`);
      });
      toast(`Receipt ${number} drafted.`);
      return receiptId;
    };

    const saveReceiptDraft = (receipt: Receipt) => {
      if (!requirePerm('receipt.manage')) return;
      commit((draft) => {
        const index = draft.receipts.findIndex((r) => r.id === receipt.id);
        if (index === -1) return;
        if (draft.receipts[index].status !== 'DRAFT') return;
        draft.receipts[index] = structuredClone(receipt);
        audit(draft, 'RECEIPT_DRAFT_SAVED', 'RECEIPT', receipt.id, `Saved draft ${receipt.number}.`);
      });
      toast('Receipt draft saved on this device.');
    };

    const confirmReceipt = (receiptId: string, draftOverride?: Receipt): boolean => {
      if (!requirePerm('receipt.manage')) return false;
      const receipt = draftOverride ?? state.receipts.find((r) => r.id === receiptId);
      if (!receipt || receipt.status !== 'DRAFT') {
        toast('This receipt is not in draft.', 'error');
        return false;
      }
      const po = receipt.poId ? state.purchaseOrders.find((p) => p.id === receipt.poId) : null;
      for (const line of receipt.lines) {
        const product = productById(state, line.productId);
        if (!product) continue;
        if (product.perishable && line.acceptedQty > 0 && !line.expiry) {
          toast(`${product.name} is perishable and needs an expiry date before confirmation.`, 'error');
          return false;
        }
        if (line.acceptedQty < 0 || line.damagedQty < 0 || line.rejectedQty < 0 || line.shortQty < 0) {
          toast('Receipt quantities cannot be negative.', 'error');
          return false;
        }
        if (line.unitCost <= 0) {
          toast('Every accepted line needs a unit cost.', 'error');
          return false;
        }
        const expected = line.expectedQty || 0;
        const received = line.acceptedQty + line.damagedQty;
        const tolerance = expected * (1 + state.settings.receiptTolerancePct / 100);
        if (expected > 0 && received > tolerance && !can(currentUser, 'po.approve')) {
          toast(
            `${product.name} is over the ${state.settings.receiptTolerancePct}% tolerance. A manager must confirm this receipt.`,
            'error',
          );
          return false;
        }
      }

      const stockBefore = computeStock(state);
      const acceptedByProduct = new Map<string, number>();
      for (const line of receipt.lines) {
        acceptedByProduct.set(
          line.productId,
          (acceptedByProduct.get(line.productId) ?? 0) + line.acceptedQty,
        );
      }

      commit((draft) => {
        const target = draft.receipts.find((r) => r.id === receiptId);
        if (!target) return;
        if (draftOverride) {
          target.lines = structuredClone(draftOverride.lines);
          target.deliveryNote = draftOverride.deliveryNote;
          target.note = draftOverride.note;
        }
        const now = new Date().toISOString();
        const touchedProducts = new Set<string>();

        target.lines.forEach((line) => {
          const product = productById(draft, line.productId);
          if (!product) return;
          let batch: Batch | undefined;
          if (line.acceptedQty > 0 || line.damagedQty > 0) {
            batch = draft.batches.find(
              (b) => b.productId === product.id && b.batchNo === line.batchNo.trim(),
            );
            if (!batch) {
              batch = {
                id: uid('bat'),
                productId: product.id,
                batchNo: line.batchNo.trim() || `${product.sku}-${new Date().toISOString().slice(0, 10)}`,
                expiry: line.expiry,
                receivedAt: now,
                supplierId: target.supplierId,
              };
              draft.batches.push(batch);
            } else if (line.expiry && !batch.expiry) {
              batch.expiry = line.expiry;
            }
          }
          if (batch && line.acceptedQty > 0) {
            addMovement(draft, {
              type: 'RECEIPT',
              productId: product.id,
              batchId: batch.id,
              qty: line.acceptedQty,
              from: null,
              to: { locationId: 'loc-shop', status: 'SELLABLE' },
              unitCost: line.unitCost,
              occurredAt: now,
              refType: 'RECEIPT',
              refId: target.id,
              reason: 'Goods received',
              note: target.number,
              transactionId: target.id,
            });
            touchedProducts.add(product.id);
          }
          if (batch && line.damagedQty > 0) {
            addMovement(draft, {
              type: 'RECEIPT',
              productId: product.id,
              batchId: batch.id,
              qty: line.damagedQty,
              from: null,
              to: { locationId: 'loc-damaged', status: 'DAMAGED' },
              unitCost: line.unitCost,
              occurredAt: now,
              refType: 'RECEIPT',
              refId: target.id,
              reason: 'Goods received damaged',
              note: target.number,
              transactionId: target.id,
            });
            touchedProducts.add(product.id);
          }
        });

        // Moving weighted average cost per product, from accepted quantity only.
        touchedProducts.forEach((productId) => {
          const product = productById(draft, productId);
          if (!product) return;
          const accepted = acceptedByProduct.get(productId) ?? 0;
          if (accepted <= 0) return;
          let acceptedValue = 0;
          let acceptedQty = 0;
          target.lines.forEach((line) => {
            if (line.productId !== productId) return;
            acceptedValue += line.acceptedQty * line.unitCost;
            acceptedQty += line.acceptedQty;
          });
          if (acceptedQty <= 0) return;
          const beforeStock = stockFor(stockBefore, productId);
          product.cost = averageCostAfterReceipt(
            beforeStock.onHand,
            product.cost,
            acceptedQty,
            acceptedValue / acceptedQty,
          );
        });

        if (po) {
          const draftPo = draft.purchaseOrders.find((p) => p.id === po.id);
          if (draftPo) {
            target.lines.forEach((line) => {
              const poLine = draftPo.lines.find((l) => l.productId === line.productId);
              if (poLine) {
                poLine.receivedQty = roundQty(poLine.receivedQty + line.acceptedQty + line.damagedQty);
              }
            });
            const fullyReceived = draftPo.lines.every(
              (line) => line.receivedQty >= line.qty - 0.0005,
            );
            draftPo.status = fullyReceived ? 'RECEIVED' : 'PART_RECEIVED';
          }
        }

        target.status = 'CONFIRMED';
        target.confirmedAt = now;
        target.confirmedBy = currentUser.id;
        target.sync = syncState();
        audit(
          draft,
          'RECEIPT_CONFIRMED',
          'RECEIPT',
          receiptId,
          `Confirmed ${target.number} and posted accepted stock.`,
          { status: 'DRAFT' },
          { status: 'CONFIRMED' },
        );
      });
      toast(`Receipt ${receipt.number} confirmed. Stock and average cost updated.`);
      return true;
    };

    const reverseReceipt = (receiptId: string): boolean => {
      if (!requirePerm('po.approve')) return false;
      const receipt = state.receipts.find((r) => r.id === receiptId);
      if (!receipt || receipt.status !== 'CONFIRMED') {
        toast('Only confirmed receipts can be reversed.', 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.receipts.find((r) => r.id === receiptId);
        if (!target) return;
        const now = new Date().toISOString();
        target.lines.forEach((line) => {
          if (!line.acceptedQty && !line.damagedQty) return;
          const batch = draft.batches.find(
            (b) => b.productId === line.productId && b.batchNo === line.batchNo,
          );
          if (!batch) return;
          if (line.acceptedQty > 0) {
            addMovement(draft, {
              type: 'RECEIPT',
              productId: line.productId,
              batchId: batch.id,
              qty: line.acceptedQty,
              from: { locationId: 'loc-shop', status: 'SELLABLE' },
              to: null,
              unitCost: line.unitCost,
              occurredAt: now,
              refType: 'RECEIPT',
              refId: target.id,
              reason: 'Receipt reversal',
              note: target.number,
              transactionId: target.id,
            });
          }
          if (line.damagedQty > 0) {
            addMovement(draft, {
              type: 'RECEIPT',
              productId: line.productId,
              batchId: batch.id,
              qty: line.damagedQty,
              from: { locationId: 'loc-damaged', status: 'DAMAGED' },
              to: null,
              unitCost: line.unitCost,
              occurredAt: now,
              refType: 'RECEIPT',
              refId: target.id,
              reason: 'Receipt reversal',
              note: target.number,
              transactionId: target.id,
            });
          }
        });
        if (target.poId) {
          const po = draft.purchaseOrders.find((p) => p.id === target.poId);
          if (po) {
            target.lines.forEach((line) => {
              const poLine = po.lines.find((l) => l.productId === line.productId);
              if (poLine) {
                poLine.receivedQty = Math.max(
                  0,
                  roundQty(poLine.receivedQty - line.acceptedQty - line.damagedQty),
                );
              }
            });
            po.status = 'SENT';
          }
        }
        target.status = 'REVERSED';
        audit(
          draft,
          'RECEIPT_REVERSED',
          'RECEIPT',
          receiptId,
          `Reversed ${target.number}; stock returned and document preserved.`,
          undefined,
          undefined,
          'Receipt reversal',
        );
      });
      toast(`Receipt ${receipt.number} reversed.`);
      return true;
    };

    const createTransfer: AppActions['createTransfer'] = (input) => {
      if (!requirePerm('stock.transfer')) return false;
      if (input.qty <= 0) {
        toast('Transfer quantity must be greater than zero.', 'error');
        return false;
      }
      if (input.fromLocationId === input.toLocationId) {
        toast('Source and destination must differ.', 'error');
        return false;
      }
      const product = productById(state, input.productId);
      const batch = batchById(state, input.batchId);
      if (!product || !batch) return false;
      const stocks = computeStock(state);
      const stock = stockFor(stocks, product.id);
      const balance = stock.batches.find(
        (b) =>
          b.batchId === input.batchId &&
          b.locationId === input.fromLocationId &&
          b.status === (input.fromLocationId === 'loc-shop' ? 'SELLABLE' : 'SELLABLE'),
      );
      const available = balance?.qty ?? 0;
      if (input.qty > available + 0.0005) {
        toast(`Only ${available} ${product.baseUnit} available at the source.`, 'error');
        return false;
      }
      const destinationSelling = state.locations.find((l) => l.id === input.toLocationId)?.sellingAllowed;
      const destinationStatus: StockStatus = destinationSelling ? 'SELLABLE' : 'SELLABLE';
      commit((draft) => {
        const id = uid('trf');
        const number = docNumber('TRF', (draft.counters.TRANSFER ?? 0) + 1);
        const now = new Date().toISOString();
        addMovement(draft, {
          type: 'TRANSFER',
          productId: input.productId,
          batchId: input.batchId,
          qty: input.qty,
          from: { locationId: input.fromLocationId, status: 'SELLABLE' },
          to: { locationId: input.toLocationId, status: destinationStatus },
          unitCost: product.cost,
          occurredAt: now,
          refType: 'TRANSFER',
          refId: id,
          reason: input.reason || 'Stock transfer',
          note: number,
          transactionId: id,
        });
        draft.transfers.unshift({
          id,
          number,
          productId: input.productId,
          batchId: input.batchId,
          qty: roundQty(input.qty),
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          status: 'POSTED',
          reason: input.reason || 'Stock transfer',
          actorId: currentUser.id,
          at: now,
          sync: syncState(),
        });
        draft.counters.TRANSFER = (draft.counters.TRANSFER ?? 0) + 1;
        audit(
          draft,
          'STOCK_TRANSFERRED',
          'TRANSFER',
          id,
          `Moved ${input.qty} ${product.baseUnit} of ${product.name} between locations.`,
          undefined,
          undefined,
          input.reason,
        );
      });
      toast('Transfer posted.');
      return true;
    };

    const changeBatchStatus: AppActions['changeBatchStatus'] = (input) => {
      if (!requirePerm('stock.status')) return false;
      if (input.qty <= 0) return false;
      if (input.fromStatus === input.toStatus) {
        toast('Choose a different destination status.', 'error');
        return false;
      }
      const product = productById(state, input.productId);
      if (!product) return false;
      const stocks = computeStock(state);
      const stock = stockFor(stocks, product.id);
      const balance = stock.batches.find(
        (b) =>
          b.batchId === input.batchId &&
          b.locationId === input.locationId &&
          b.status === input.fromStatus,
      );
      if (!balance || input.qty > balance.qty + 0.0005) {
        toast('Not enough stock in that status to move.', 'error');
        return false;
      }
      commit((draft) => {
        const id = uid('adj');
        const now = new Date().toISOString();
        addMovement(draft, {
          type: 'STATUS_CHANGE',
          productId: input.productId,
          batchId: input.batchId,
          qty: input.qty,
          from: { locationId: input.locationId, status: input.fromStatus },
          to: { locationId: input.locationId, status: input.toStatus },
          unitCost: product.cost,
          occurredAt: now,
          refType: 'ADJUSTMENT',
          refId: id,
          reason: input.reason,
          note: `${input.fromStatus} → ${input.toStatus}`,
        });
        audit(
          draft,
          'BATCH_STATUS_CHANGED',
          'BATCH',
          input.batchId,
          `Moved ${input.qty} ${product.baseUnit} of ${product.name} from ${input.fromStatus} to ${input.toStatus}.`,
          { status: input.fromStatus },
          { status: input.toStatus },
          input.reason,
        );
      });
      toast('Stock status updated.');
      return true;
    };

    const requestWriteOff: AppActions['requestWriteOff'] = (input) => {
      if (!requirePerm('writeoff.create')) return false;
      if (input.qty <= 0) {
        toast('Write-off quantity must be greater than zero.', 'error');
        return false;
      }
      const product = productById(state, input.productId);
      const batch = batchById(state, input.batchId);
      if (!product || !batch) return false;
      const stock = stockFor(computeStock(state), product.id);
      const balances = stock.batches.filter((b) => b.batchId === input.batchId);
      const available = balances.reduce((sum, b) => sum + Math.max(0, b.qty), 0);
      if (input.qty > available + 0.0005) {
        toast(`Only ${available} ${product.baseUnit} available in that batch.`, 'error');
        return false;
      }
      if (!input.reason.trim()) {
        toast('A write-off reason is required.', 'error');
        return false;
      }
      commit((draft) => {
        const id = uid('wo');
        const number = docNumber('WO', (draft.counters.WRITE_OFF ?? 0) + 1);
        draft.writeOffs.unshift({
          id,
          number,
          productId: input.productId,
          batchId: input.batchId,
          qty: roundQty(input.qty),
          reason: input.reason,
          note: input.note,
          unitCost: product.cost,
          value: Math.round(input.qty * product.cost),
          status: 'PENDING_APPROVAL',
          requestedBy: currentUser.id,
          requestedAt: new Date().toISOString(),
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        });
        draft.counters.WRITE_OFF = (draft.counters.WRITE_OFF ?? 0) + 1;
        audit(
          draft,
          'WRITE_OFF_REQUESTED',
          'WRITE_OFF',
          id,
          `Requested write-off ${number} for ${input.qty} ${product.baseUnit} of ${product.name}.`,
          undefined,
          undefined,
          input.reason,
        );
      });
      toast('Write-off submitted for independent approval.');
      return true;
    };

    const approveWriteOff = (writeOffId: string, note: string): boolean => {
      if (!requirePerm('writeoff.approve')) return false;
      const writeOff = state.writeOffs.find((w) => w.id === writeOffId);
      if (!writeOff || writeOff.status !== 'PENDING_APPROVAL') return false;
      if (writeOff.requestedBy === currentUser.id) {
        toast('You cannot approve your own write-off.', 'error');
        return false;
      }
      const limit = approvalLimitFor(
        currentUser.role,
        state.settings.approvalLimitManager,
        state.settings.approvalLimitOwner,
      );
      if (writeOff.value > limit) {
        toast('This write-off exceeds your approval limit.', 'error');
        return false;
      }
      const product = productById(state, writeOff.productId);
      const stock = product ? stockFor(computeStock(state), product.id) : null;
      const balances = stock?.batches.filter((b) => b.batchId === writeOff.batchId) ?? [];
      const source = balances.sort((a, b) => b.qty - a.qty)[0];
      if (!product || !source || source.qty < writeOff.qty - 0.0005) {
        toast('Stock is no longer available; refresh and request again.', 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.writeOffs.find((w) => w.id === writeOffId);
        if (!target) return;
        const targetProduct = productById(draft, target.productId);
        if (!targetProduct) return;
        const id = uid('wo');
        addMovement(draft, {
          type: 'WRITE_OFF',
          productId: target.productId,
          batchId: target.batchId,
          qty: target.qty,
          from: { locationId: source.locationId, status: source.status },
          to: null,
          unitCost: target.unitCost,
          occurredAt: new Date().toISOString(),
          refType: 'WRITE_OFF',
          refId: target.id,
          reason: target.reason,
          note: target.number,
          transactionId: id,
        });
        target.status = 'POSTED';
        target.decidedBy = currentUser.id;
        target.decidedAt = new Date().toISOString();
        target.decisionNote = note;
        audit(
          draft,
          'WRITE_OFF_POSTED',
          'WRITE_OFF',
          writeOffId,
          `Posted write-off ${target.number} for ${target.qty} ${targetProduct.baseUnit} of ${targetProduct.name}.`,
          { status: 'PENDING_APPROVAL' },
          { status: 'POSTED' },
          note,
        );
      });
      toast('Write-off approved and stock reduced.');
      return true;
    };

    const rejectWriteOff = (writeOffId: string, note: string) => {
      if (!requirePerm('writeoff.approve')) return;
      commit((draft) => {
        const target = draft.writeOffs.find((w) => w.id === writeOffId);
        if (!target || target.status !== 'PENDING_APPROVAL') return;
        target.status = 'REJECTED';
        target.decidedBy = currentUser.id;
        target.decidedAt = new Date().toISOString();
        target.decisionNote = note;
        audit(draft, 'WRITE_OFF_REJECTED', 'WRITE_OFF', writeOffId, `Rejected write-off ${target.number}.`, undefined, undefined, note);
      });
      toast('Write-off rejected.');
    };

    const createCount: AppActions['createCount'] = (scope, locationId, productIds) => {
      if (!requirePerm('count.create')) return null;
      if (!productIds.length) {
        toast('Select at least one product for the count.', 'error');
        return null;
      }
      const stocks = computeStock(state);
      const id = uid('cnt');
      const number = docNumber('CNT', (state.counters.COUNT ?? 0) + 1);
      commit((draft) => {
        draft.counts.unshift({
          id,
          number,
          scope,
          locationId,
          status: 'OPEN',
          entries: productIds.map((productId) => ({
            id: uid('cen'),
            productId,
            systemQty: stockFor(stocks, productId).sellable,
            countedQty: null,
            recountQty: null,
            note: '',
          })),
          snapshotSeq: draft.seq,
          counterId: currentUser.id,
          submittedAt: null,
          submittedBy: null,
          approvedAt: null,
          approvedBy: null,
          rejectionComment: null,
          postedAt: null,
          createdAt: new Date().toISOString(),
        });
        draft.counters.COUNT = (draft.counters.COUNT ?? 0) + 1;
        audit(draft, 'COUNT_CREATED', 'STOCK_COUNT', id, `Opened blind count ${number} (${productIds.length} lines).`);
      });
      toast(`Count ${number} opened. ${productIds.length} blind lines.`);
      return id;
    };

    const saveCountEntries: AppActions['saveCountEntries'] = (countId, entries) => {
      if (!requirePerm('count.count')) return;
      commit((draft) => {
        const count = draft.counts.find((c) => c.id === countId);
        if (!count || (count.status !== 'OPEN' && count.status !== 'RECOUNT_REQUIRED')) return;
        entries.forEach((entry) => {
          const target = count.entries.find((e) => e.id === entry.id);
          if (!target) return;
          target.countedQty = entry.countedQty;
          target.note = entry.note;
        });
        audit(draft, 'COUNT_SAVED', 'STOCK_COUNT', countId, `Saved count entries for ${count.number}.`);
      });
      toast('Count saved. You can resume on any device.');
    };

    const countVarianceValue = (countId: string): number => {
      const count = state.counts.find((c) => c.id === countId);
      if (!count) return 0;
      return count.entries.reduce((sum, entry) => {
        const product = productById(state, entry.productId);
        const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
        return sum + Math.abs(counted - entry.systemQty) * (product?.cost ?? 0);
      }, 0);
    };

    const submitCount = (countId: string, entries?: { id: string; countedQty: number | null; note: string }[]): boolean => {
      if (!requirePerm('count.count')) return false;
      const stored = state.counts.find((c) => c.id === countId);
      if (!stored) return false;
      if (stored.status !== 'OPEN' && stored.status !== 'RECOUNT_REQUIRED') {
        toast('This count has already been submitted.', 'error');
        return false;
      }
      const count = entries
        ? {
            ...stored,
            entries: stored.entries.map((entry) => {
              const patch = entries.find((item) => item.id === entry.id);
              return patch ? { ...entry, countedQty: patch.countedQty, note: patch.note } : entry;
            }),
          }
        : stored;
      const missing = count.entries.filter((e) => e.countedQty === null);
      if (missing.length) {
        toast(`${missing.length} line(s) still need a physical count. Enter 0 where the shelf is empty.`, 'error');
        return false;
      }
      const variance = count.entries.reduce((sum, entry) => {
        const product = productById(state, entry.productId);
        const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
        return sum + Math.abs(counted - entry.systemQty) * (product?.cost ?? 0);
      }, 0);
      const threshold = state.settings.countVarianceThreshold;
      const requiresRecount = variance > threshold;
      commit((draft) => {
        const target = draft.counts.find((c) => c.id === countId);
        if (!target) return;
        if (entries) {
          entries.forEach((entry) => {
            const line = target.entries.find((e) => e.id === entry.id);
            if (line) {
              line.countedQty = entry.countedQty;
              line.note = entry.note;
            }
          });
        }
        target.submittedAt = new Date().toISOString();
        target.submittedBy = currentUser.id;
        target.status = requiresRecount ? 'RECOUNT_REQUIRED' : 'PENDING_APPROVAL';
        audit(
          draft,
          'COUNT_SUBMITTED',
          'STOCK_COUNT',
          countId,
          `Submitted ${target.number} with variance value ${(variance / 100).toLocaleString('en-NG')} naira.`,
          undefined,
          { status: target.status },
        );
        if (requiresRecount) {
          raiseVarianceAlert(draft, countId, target.number, variance);
        }
      });
      if (requiresRecount) {
        toast('Variance is above threshold. A recount is required before approval.', 'info');
      } else {
        toast('Count submitted for approval.');
      }
      return true;
    };

    const saveRecount: AppActions['saveRecount'] = (countId, entries) => {
      if (!requirePerm('count.count')) return;
      commit((draft) => {
        const count = draft.counts.find((c) => c.id === countId);
        if (!count || count.status !== 'RECOUNT_REQUIRED') return;
        entries.forEach((entry) => {
          const target = count.entries.find((e) => e.id === entry.id);
          if (target) target.recountQty = entry.recountQty;
        });
        const allCounted = count.entries.every((e) => e.recountQty !== null);
        if (allCounted) {
          count.status = 'PENDING_APPROVAL';
          count.submittedAt = new Date().toISOString();
          count.submittedBy = currentUser.id;
        }
        audit(draft, 'COUNT_RECOUNTED', 'STOCK_COUNT', countId, `Saved recount for ${count.number}.`);
      });
      toast('Recount saved.');
    };

    const approveCount = (countId: string, comment: string): boolean => {
      if (!requirePerm('count.approve')) return false;
      const count = state.counts.find((c) => c.id === countId);
      if (!count || count.status !== 'PENDING_APPROVAL') {
        toast('Only submitted counts can be approved.', 'error');
        return false;
      }
      if (count.counterId === currentUser.id || count.submittedBy === currentUser.id) {
        toast('You cannot approve a count you performed or submitted.', 'error');
        return false;
      }
      const limit = approvalLimitFor(
        currentUser.role,
        state.settings.approvalLimitManager,
        state.settings.approvalLimitOwner,
      );
      const variance = countVarianceValue(countId);
      if (variance > limit) {
        toast('This variance exceeds your approval limit.', 'error');
        return false;
      }
      commit((draft) => {
        const target = draft.counts.find((c) => c.id === countId);
        if (!target) return;
        const now = new Date().toISOString();
        target.entries.forEach((entry) => {
          const product = productById(draft, entry.productId);
          if (!product) return;
          const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
          const delta = roundQty(counted - entry.systemQty);
          if (Math.abs(delta) < 0.0005) return;
          const anyBatch = draft.batches.find((b) => b.productId === product.id);
          if (!anyBatch) return;
          addMovement(draft, {
            type: 'COUNT',
            productId: product.id,
            batchId: anyBatch.id,
            qty: Math.abs(delta),
            from: delta < 0 ? { locationId: target.locationId, status: 'SELLABLE' } : null,
            to: delta > 0 ? { locationId: target.locationId, status: 'SELLABLE' } : null,
            unitCost: product.cost,
            occurredAt: now,
            refType: 'COUNT',
            refId: target.id,
            reason: 'Count variance',
            note: target.number,
            transactionId: target.id,
          });
        });
        target.status = 'POSTED';
        target.approvedAt = now;
        target.approvedBy = currentUser.id;
        target.postedAt = now;
        audit(
          draft,
          'COUNT_POSTED',
          'STOCK_COUNT',
          countId,
          `Approved and posted ${target.number}; adjustments applied.`,
          { status: 'PENDING_APPROVAL' },
          { status: 'POSTED' },
          comment,
        );
      });
      toast('Count approved and adjustments posted.');
      return true;
    };

    const rejectCount = (countId: string, comment: string) => {
      if (!requirePerm('count.approve')) return;
      commit((draft) => {
        const target = draft.counts.find((c) => c.id === countId);
        if (!target) return;
        target.status = 'OPEN';
        target.rejectionComment = comment;
        audit(draft, 'COUNT_REJECTED', 'STOCK_COUNT', countId, `Rejected ${target.number}; returned to open.`, undefined, undefined, comment);
      });
      toast('Count rejected and returned for correction.');
    };

    const cancelCount = (countId: string) => {
      if (!requirePerm('count.create')) return;
      commit((draft) => {
        const target = draft.counts.find((c) => c.id === countId);
        if (!target || !['OPEN', 'RECOUNT_REQUIRED'].includes(target.status)) return;
        target.status = 'CANCELLED';
        audit(draft, 'COUNT_CANCELLED', 'STOCK_COUNT', countId, `Cancelled ${target.number}.`);
      });
      toast('Count cancelled.');
    };

    const updateSettings = (patch: Partial<Settings>) => {
      if (!requirePerm('admin.settings')) return;
      commit((draft) => {
        const before = { ...draft.settings };
        Object.assign(draft.settings, patch);
        audit(draft, 'SETTINGS_UPDATED', 'SETTINGS', draft.store.id, 'Updated store policies.', before, draft.settings);
      });
      toast('Settings saved.');
    };

    const addUser = (input: { name: string; role: Role; phone: string }): boolean => {
      if (!requirePerm('admin.users')) return false;
      if (!input.name.trim() || !input.phone.trim()) {
        toast('Name and phone number are required.', 'error');
        return false;
      }
      const id = uid('usr');
      commit((draft) => {
        const user: User = {
          id,
          name: input.name.trim(),
          role: input.role,
          phone: input.phone.trim(),
          active: true,
        };
        draft.users.push(user);
        audit(draft, 'USER_CREATED', 'USER', id, `Added ${user.name} as ${user.role}.`);
      });
      toast('User added.');
      return true;
    };

    const updateUser = (userId: string, input: { name: string; role: Role; phone: string }): boolean => {
      if (!requirePerm('admin.users')) return false;
      if (!input.name.trim() || !input.phone.trim()) {
        toast('Name and phone number are required.', 'error');
        return false;
      }
      const target = state.users.find((u) => u.id === userId);
      if (!target) return false;
      if (userId === currentUser.id && input.role !== target.role) {
        toast('You cannot change your own role.', 'error');
        return false;
      }
      if (input.role === 'owner' && target.role !== 'owner' && currentUser.role !== 'owner') {
        toast('Only an owner can assign the owner role.', 'error');
        return false;
      }
      const before = { name: target.name, role: target.role, phone: target.phone };
      commit((draft) => {
        const user = draft.users.find((u) => u.id === userId);
        if (!user) return;
        user.name = input.name.trim();
        user.role = input.role;
        user.phone = input.phone.trim();
        audit(
          draft,
          'USER_UPDATED',
          'USER',
          userId,
          `Updated ${user.name}'s details (${before.role} → ${user.role}).`,
          before,
          { name: user.name, role: user.role, phone: user.phone },
        );
      });
      toast('User details updated.');
      return true;
    };

    const resetUserPassword = async (userId: string): Promise<{ password: string; resetAt: string } | null> => {
      if (!requirePerm('admin.users')) return null;
      const target = state.users.find((u) => u.id === userId);
      if (!target) return null;
      const password = generateTemporaryPassword();
      const passwordHash = await hashPassword(password);
      const resetAt = new Date().toISOString();
      commit((draft) => {
        const user = draft.users.find((u) => u.id === userId);
        if (!user) return;
        user.passwordHash = passwordHash;
        user.passwordUpdatedAt = resetAt;
        audit(
          draft,
          'USER_PASSWORD_RESET',
          'USER',
          userId,
          `Reset the password for ${user.name}.`,
          { passwordUpdatedAt: target.passwordUpdatedAt ?? null },
          { passwordUpdatedAt: resetAt },
        );
      });
      toast(`Password reset for ${target.name}.`);
      return { password, resetAt };
    };

    const deleteUser = (userId: string): boolean => {
      if (!requirePerm('admin.users')) return false;
      const target = state.users.find((u) => u.id === userId);
      if (!target) return false;
      if (userId === currentUser.id) {
        toast('You cannot delete your own account.', 'error');
        return false;
      }
      const activeOwners = state.users.filter((u) => u.role === 'owner' && u.active);
      if (target.role === 'owner' && target.active && activeOwners.length <= 1) {
        toast('The last active owner cannot be deleted.', 'error');
        return false;
      }
      const before = { name: target.name, role: target.role, phone: target.phone };
      commit((draft) => {
        const index = draft.users.findIndex((u) => u.id === userId);
        if (index === -1) return;
        audit(draft, 'USER_DELETED', 'USER', userId, `Deleted ${target.name} (${target.role}).`, before);
        draft.users.splice(index, 1);
      });
      toast(`${target.name} deleted.`);
      return true;
    };

    const toggleUser = (userId: string) => {
      if (!requirePerm('admin.users')) return;
      if (userId === currentUser.id) {
        toast('You cannot deactivate your own account.', 'error');
        return;
      }
      const target = state.users.find((u) => u.id === userId);
      if (!target) return;
      const activeOwners = state.users.filter((u) => u.role === 'owner' && u.active);
      if (target.active && target.role === 'owner' && activeOwners.length <= 1) {
        toast('The last active owner cannot be disabled.', 'error');
        return;
      }
      commit((draft) => {
        const user = draft.users.find((u) => u.id === userId);
        if (!user) return;
        user.active = !user.active;
        audit(
          draft,
          user.active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
          'USER',
          userId,
          `${user.active ? 'Reactivated' : 'Deactivated'} ${user.name}.`,
          { active: !user.active },
          { active: user.active },
        );
      });
      toast('User status updated.');
    };

    const markAlertAction: AppActions['markAlertAction'] = (alertId, action, note = '', snoozeHours = 24) => {
      if (!requirePerm('alert.manage')) return;
      commit((draft) => {
        markAlert(draft, alertId, currentUser.id, currentUser.name, action, note, snoozeHours);
        const alert = draft.alerts.find((a) => a.id === alertId);
        if (alert) {
          audit(draft, `ALERT_${action.toUpperCase()}`, 'ALERT', alertId, `${action} alert: ${alert.title}.`, undefined, undefined, note);
        }
      });
      toast(`Alert ${action}d.`);
    };

    const syncNow = () => {
      if (!online) {
        toast('Still offline. Changes remain queued on this device.', 'error');
        return;
      }
      const queued = pendingSyncCount;
      commit((draft) => {
        draft.movements.forEach((m) => {
          m.sync = 'SYNCED';
        });
        draft.sales.forEach((s) => {
          s.sync = 'SYNCED';
        });
        draft.receipts.forEach((r) => {
          r.sync = 'SYNCED';
        });
        draft.transfers.forEach((t) => {
          t.sync = 'SYNCED';
        });
        draft.lastSyncAt = new Date().toISOString();
        audit(
          draft,
          'SYNC_COMPLETED',
          'SYSTEM',
          draft.deviceId,
          queued > 0
            ? `Acknowledged ${queued} queued document(s) from ${draft.deviceId}.`
            : `Device ${draft.deviceId} checked in with no queued work.`,
        );
      });
      toast(queued > 0 ? `Synced ${queued} queued document(s).` : 'Already up to date.');
    };

    const resetDemo = () => {
      const fresh = createSeedState();
      setState(fresh);
      persist(fresh);
      toast('Demo data reset to the seeded baseline.');
    };

    const importState = (json: string): boolean => {
      try {
        const parsed = JSON.parse(json) as DemoState;
        if (!parsed.products || !parsed.movements || parsed.version !== 1) {
          toast('That file is not a Storehouse backup.', 'error');
          return false;
        }
        setState(parsed);
        persist(parsed);
        toast('Backup restored.');
        return true;
      } catch {
        toast('Could not read that backup file.', 'error');
        return false;
      }
    };

    return {
      saveProduct,
      toggleProduct,
      updateProductPrice,
      createSale,
      voidSale,
      returnSale,
      createPurchaseOrder,
      submitPurchaseOrder,
      approvePurchaseOrder,
      rejectPurchaseOrder,
      sendPurchaseOrder,
      cancelPurchaseOrder,
      closeShort,
      createReceiptDraft,
      saveReceiptDraft,
      confirmReceipt,
      reverseReceipt,
      createTransfer,
      changeBatchStatus,
      requestWriteOff,
      approveWriteOff,
      rejectWriteOff,
      createCount,
      saveCountEntries,
      submitCount,
      saveRecount,
      approveCount,
      rejectCount,
      cancelCount,
      updateSettings,
      addUser,
      updateUser,
      resetUserPassword,
      deleteUser,
      toggleUser,
      switchUser,
      signInServerUser,
      markAlertAction,
      syncNow,
      resetDemo,
      importState,
      toast,
      canDo,
    };
  }, [
    actor.id,
    actor.name,
    addMovement,
    canDo,
    commit,
    currentUser,
    online,
    pendingSyncCount,
    requirePerm,
    state,
    syncState,
    toast,
  ]);

  const setSimulateOffline = useCallback(
    (value: boolean) => {
      setSimulateOfflineState(value);
      toast(value ? 'Offline mode on. New work is queued locally.' : 'Back online. Sync queued work when ready.', 'info');
    },
    [toast],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      currentUser,
      stockMap,
      stockValue,
      alerts,
      activeAlerts,
      reorder,
      pendingSyncCount,
      online,
      simulateOffline,
      setSimulateOffline,
      toasts,
      dismissToast,
      actions,
    }),
    [
      state,
      currentUser,
      stockMap,
      stockValue,
      alerts,
      activeAlerts,
      reorder,
      pendingSyncCount,
      online,
      simulateOffline,
      setSimulateOffline,
      toasts,
      dismissToast,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
