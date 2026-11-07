import type {
  Batch,
  DemoState,
  Location,
  Movement,
  Product,
  StockStatus,
} from '../types';
import { daysUntil } from '../lib/format';

export interface StockState {
  products: Product[];
  locations: Location[];
  batches: Batch[];
  movements: Movement[];
}

export interface StockBalance {
  productId: string;
  batchId: string;
  locationId: string;
  status: StockStatus;
  qty: number;
}

export interface BatchBalance extends StockBalance {
  batch: Batch;
}

export interface ProductStock {
  productId: string;
  onHand: number;
  sellable: number;
  storageSellable: number;
  nonSellable: number;
  expired: number;
  available: number;
  signedAvailable: number;
  byStatus: Partial<Record<StockStatus, number>>;
  batches: BatchBalance[];
  locations: { locationId: string; qty: number }[];
}

const EPSILON = 0.0005;

export function balanceKey(productId: string, batchId: string, locationId: string, status: StockStatus): string {
  return `${productId}|${batchId}|${locationId}|${status}`;
}

export function computeBalances(movements: Movement[]): StockBalance[] {
  const map = new Map<string, StockBalance>();
  const apply = (
    productId: string,
    batchId: string,
    endpoint: { locationId: string; status: StockStatus } | null,
    delta: number,
  ) => {
    if (!endpoint) return;
    const key = balanceKey(productId, batchId, endpoint.locationId, endpoint.status);
    const current = map.get(key);
    if (current) current.qty += delta;
    else
      map.set(key, {
        productId,
        batchId,
        locationId: endpoint.locationId,
        status: endpoint.status,
        qty: delta,
      });
  };
  for (const m of movements) {
    apply(m.productId, m.batchId, m.from, -m.qty);
    apply(m.productId, m.batchId, m.to, m.qty);
  }
  return [...map.values()].filter((b) => Math.abs(b.qty) > EPSILON);
}

export function computeStock(state: StockState): Map<string, ProductStock> {
  const balances = computeBalances(state.movements);
  const locationById = new Map(state.locations.map((l) => [l.id, l]));
  const batchById = new Map(state.batches.map((b) => [b.id, b]));
  const result = new Map<string, ProductStock>();

  for (const product of state.products) {
    result.set(product.id, {
      productId: product.id,
      onHand: 0,
      sellable: 0,
      storageSellable: 0,
      nonSellable: 0,
      expired: 0,
      available: 0,
      signedAvailable: 0,
      byStatus: {},
      batches: [],
      locations: [],
    });
  }

  for (const balance of balances) {
    const stock = result.get(balance.productId);
    if (!stock) continue;
    const loc = locationById.get(balance.locationId);
    const batch = batchById.get(balance.batchId);
    const expiredByDate = batch ? isExpiredBatch(batch) : false;
    stock.onHand += balance.qty;
    stock.byStatus[balance.status] = (stock.byStatus[balance.status] ?? 0) + balance.qty;

    if (balance.status === 'SELLABLE') {
      // Date-expired batches remain SELLABLE in the ledger until a status
      // change posts, but they must never count as available to sell.
      if (expiredByDate) stock.nonSellable += balance.qty;
      else if (loc?.sellingAllowed) stock.sellable += balance.qty;
      else stock.storageSellable += balance.qty;
    } else {
      stock.nonSellable += balance.qty;
    }
    if (balance.status === 'EXPIRED' || expiredByDate) stock.expired += balance.qty;

    if (batch) stock.batches.push({ ...balance, batch });

    const existing = stock.locations.find((l) => l.locationId === balance.locationId);
    if (existing) existing.qty += balance.qty;
    else stock.locations.push({ locationId: balance.locationId, qty: balance.qty });
  }

  for (const stock of result.values()) {
    stock.signedAvailable = stock.sellable;
    stock.available = Math.max(0, stock.sellable);
    stock.batches.sort((a, b) => {
      const ax = a.batch.expiry ? new Date(a.batch.expiry).getTime() : Number.MAX_SAFE_INTEGER;
      const bx = b.batch.expiry ? new Date(b.batch.expiry).getTime() : Number.MAX_SAFE_INTEGER;
      return ax - bx;
    });
  }

  return result;
}

export function stockFor(stockMap: Map<string, ProductStock>, productId: string): ProductStock {
  return (
    stockMap.get(productId) ?? {
      productId,
      onHand: 0,
      sellable: 0,
      storageSellable: 0,
      nonSellable: 0,
      expired: 0,
      available: 0,
      signedAvailable: 0,
      byStatus: {},
      batches: [],
      locations: [],
    }
  );
}

export function sellableBatches(
  stock: ProductStock,
  locationId: string,
  includeExpired = false,
): BatchBalance[] {
  return stock.batches
    .filter((b) => b.locationId === locationId && b.status === 'SELLABLE' && b.qty > EPSILON)
    .filter((b) => includeExpired || !isExpiredBatch(b.batch))
    .sort((a, b) => {
      const ax = a.batch.expiry ? new Date(a.batch.expiry).getTime() : Number.MAX_SAFE_INTEGER;
      const bx = b.batch.expiry ? new Date(b.batch.expiry).getTime() : Number.MAX_SAFE_INTEGER;
      return ax - bx;
    });
}

export interface Allocation {
  batchId: string;
  qty: number;
}

/** FEFO allocation limited to what is physically available at a selling location. */
export function allocateFefo(
  stock: ProductStock,
  locationId: string,
  requested: number,
  includeExpired = false,
): { allocations: Allocation[]; shortfall: number } {
  let remaining = requested;
  const allocations: Allocation[] = [];
  for (const batch of sellableBatches(stock, locationId, includeExpired)) {
    if (remaining <= EPSILON) break;
    const take = Math.min(batch.qty, remaining);
    if (take > EPSILON) {
      allocations.push({ batchId: batch.batchId, qty: roundQty(take) });
      remaining -= take;
    }
  }
  return { allocations, shortfall: Math.max(0, roundQty(remaining)) };
}

export function isExpiredBatch(batch: Batch): boolean {
  const days = daysUntil(batch.expiry);
  return days !== null && days < 0;
}

export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function onOrderForProduct(state: DemoState, productId: string): number {
  let total = 0;
  for (const po of state.purchaseOrders) {
    if (!['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status)) continue;
    for (const line of po.lines) {
      if (line.productId === productId) total += Math.max(0, line.qty - line.receivedQty);
    }
  }
  return roundQty(total);
}

export function onOrderForLine(state: DemoState, poId: string, lineId: string): number {
  const po = state.purchaseOrders.find((p) => p.id === poId);
  const line = po?.lines.find((l) => l.id === lineId);
  if (!po || !line) return 0;
  if (!['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status)) return 0;
  return Math.max(0, line.qty - line.receivedQty);
}

export interface ReorderSuggestion {
  product: Product;
  demandWindowDays: number;
  soldInWindow: number;
  avgDailyDemand: number;
  leadDays: number;
  reviewDays: number;
  safetyStock: number;
  reorderPoint: number;
  available: number;
  onHand: number;
  onOrder: number;
  target: number;
  need: number;
  suggestedQty: number;
  manualRule: boolean;
  daysCover: number | null;
  status: 'OUT' | 'LOW' | 'OK';
  reason: string;
}

export function reorderSuggestion(
  state: DemoState,
  product: Product,
  stock: ProductStock,
  now = new Date(),
  windowDays = 28,
): ReorderSuggestion {
  const supplier = state.suppliers.find((s) => s.id === product.supplierId);
  const leadDays = supplier?.leadTimeDays ?? 3;
  const reviewDays = supplier?.reviewDays ?? 2;
  const from = now.getTime() - windowDays * 86_400_000;
  let sold = 0;
  for (const m of state.movements) {
    if (m.productId !== product.id) continue;
    if (m.type !== 'SALE') continue;
    if (new Date(m.occurredAt).getTime() < from) continue;
    sold += m.qty;
  }
  const avgDaily = sold / windowDays;
  const onOrder = onOrderForProduct(state, product.id);
  const manualRule = sold <= 0;
  const derivedPoint = manualRule
    ? product.reorderPoint
    : Math.ceil(avgDaily * (leadDays + reviewDays) + product.safetyStock);
  const reorderPoint = Math.max(product.reorderPoint, derivedPoint);
  const target = reorderPoint;
  const need = Math.max(0, target - stock.signedAvailable - onOrder);
  const multiple = Math.max(1, product.reorderMultiple);
  const suggestedQty = need <= 0 ? 0 : Math.ceil(need / multiple) * multiple;
  const daysCover = avgDaily > 0 ? stock.signedAvailable / avgDaily : null;
  const status: ReorderSuggestion['status'] =
    stock.signedAvailable <= 0 ? 'OUT' : stock.signedAvailable <= reorderPoint ? 'LOW' : 'OK';
  const reason = manualRule
    ? 'Manual reorder rule — sales history is not sufficient to forecast demand.'
    : `${avgDaily.toFixed(2)} ${product.baseUnit}/day × ${leadDays + reviewDays}-day cover + ${product.safetyStock} safety stock.`;

  return {
    product,
    demandWindowDays: windowDays,
    soldInWindow: roundQty(sold),
    avgDailyDemand: avgDaily,
    leadDays,
    reviewDays,
    safetyStock: product.safetyStock,
    reorderPoint,
    available: stock.signedAvailable,
    onHand: stock.onHand,
    onOrder,
    target,
    need: roundQty(need),
    suggestedQty,
    manualRule,
    daysCover,
    status,
    reason,
  };
}

export interface StockValueSummary {
  onHandUnits: number;
  sellableUnits: number;
  totalCostValue: number;
  sellableCostValue: number;
  nonSellableCostValue: number;
  retailValue: number;
  marginValue: number;
  skuCount: number;
  negativeSkus: number;
  expiredUnits: number;
  expiredValue: number;
}

export function computeStockValue(state: DemoState, stockMap?: Map<string, ProductStock>): StockValueSummary {
  const stocks = stockMap ?? computeStock(state);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  let units = 0;
  let sellableUnits = 0;
  let cost = 0;
  let sellableCost = 0;
  let nonSellableCost = 0;
  let retail = 0;
  let margin = 0;
  let negative = 0;
  let expired = 0;
  let expiredValue = 0;
  let skus = 0;

  for (const [productId, stock] of stocks) {
    const product = productById.get(productId);
    if (!product) continue;
    units += stock.onHand;
    sellableUnits += stock.sellable;
    cost += stock.onHand * product.cost;
    sellableCost += stock.sellable * product.cost;
    nonSellableCost += (stock.nonSellable + stock.storageSellable) * product.cost;
    retail += stock.sellable * product.price;
    margin += stock.sellable * (product.price - product.cost);
    expired += stock.expired;
    expiredValue += stock.expired * product.cost;
    if (stock.onHand < -EPSILON) negative += 1;
    if (Math.abs(stock.onHand) > EPSILON) skus += 1;
  }

  return {
    onHandUnits: roundQty(units),
    sellableUnits: roundQty(sellableUnits),
    totalCostValue: Math.round(cost),
    sellableCostValue: Math.round(sellableCost),
    nonSellableCostValue: Math.round(nonSellableCost),
    retailValue: Math.round(retail),
    marginValue: Math.round(margin),
    skuCount: skus,
    negativeSkus: negative,
    expiredUnits: roundQty(expired),
    expiredValue: Math.round(expiredValue),
  };
}

export interface ExpiryExposure {
  batch: Batch;
  product: Product;
  qty: number;
  value: number;
  days: number;
  state: 'EXPIRED' | 'CRITICAL' | 'WATCH' | 'OK';
}

export function computeExpiryExposure(
  state: DemoState,
  stockMap?: Map<string, ProductStock>,
  warningDays = 30,
): ExpiryExposure[] {
  const stocks = stockMap ?? computeStock(state);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const list: ExpiryExposure[] = [];
  for (const stock of stocks.values()) {
    for (const b of stock.batches) {
      if (!b.batch.expiry || b.qty <= EPSILON) continue;
      const product = productById.get(b.productId);
      if (!product) continue;
      const days = daysUntil(b.batch.expiry) ?? 0;
      const perishableStatus = b.status === 'SELLABLE' || b.status === 'EXPIRED' || b.status === 'QUARANTINE';
      if (!perishableStatus) continue;
      const limit = product.expiryWarningDays || warningDays;
      const expiryState: ExpiryExposure['state'] =
        b.status === 'EXPIRED' || days < 0 ? 'EXPIRED' : days <= Math.ceil(limit / 3) ? 'CRITICAL' : days <= limit ? 'WATCH' : 'OK';
      if (expiryState === 'OK') continue;
      list.push({
        batch: b.batch,
        product,
        qty: b.qty,
        value: Math.round(b.qty * product.cost),
        days,
        state: expiryState,
      });
    }
  }
  return list.sort((a, b) => a.days - b.days);
}

export function averageCostAfterReceipt(
  currentQty: number,
  currentCost: number,
  acceptedQty: number,
  receiptUnitCost: number,
): number {
  if (acceptedQty <= 0) return currentCost;
  if (currentQty <= 0) return Math.round(receiptUnitCost);
  const totalValue = currentQty * currentCost + acceptedQty * receiptUnitCost;
  return Math.round(totalValue / (currentQty + acceptedQty));
}

export function movementSignFor(movement: Movement, key: string): number {
  let sign = 0;
  if (movement.from) {
    const fromKey = balanceKey(movement.productId, movement.batchId, movement.from.locationId, movement.from.status);
    if (fromKey === key) sign -= movement.qty;
  }
  if (movement.to) {
    const toKey = balanceKey(movement.productId, movement.batchId, movement.to.locationId, movement.to.status);
    if (toKey === key) sign += movement.qty;
  }
  return sign;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Opening balance',
  RECEIPT: 'Goods receipt',
  SALE: 'Sale',
  VOID: 'Void reversal',
  RETURN: 'Customer return',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  WRITE_OFF: 'Write-off',
  STATUS_CHANGE: 'Status change',
  COUNT: 'Count adjustment',
};

export const STATUS_LABELS: Record<StockStatus, string> = {
  SELLABLE: 'Sellable',
  QUARANTINE: 'Quarantine',
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
  RECALL: 'Recall',
  RETURN_PENDING: 'Return pending',
};

export const ALERT_TYPE_LABELS: Record<string, string> = {
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Low stock',
  NEAR_EXPIRY: 'Near expiry',
  EXPIRED_STOCK: 'Expired stock',
  NEGATIVE_STOCK: 'Negative stock',
  LARGE_VARIANCE: 'Large count variance',
  SYNC_FAILURE: 'Sync failure',
  SLOW_MOVING: 'Slow moving',
};
