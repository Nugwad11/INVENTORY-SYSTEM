import type {
  Alert,
  AlertSeverity,
  AlertType,
  DemoState,
  Role,
} from '../types';
import { computeStock } from './inventory';
import { daysUntil } from '../lib/format';
import { uid } from '../lib/id';

interface Condition {
  type: AlertType;
  severity: AlertSeverity;
  entityType: Alert['entityType'];
  entityId: string;
  productId: string | null;
  title: string;
  detail: string;
  value: number;
  ownerRole: Role;
}

function systemAction(action: string, note: string) {
  return {
    id: uid('act'),
    actorId: 'system',
    actorName: 'System',
    action,
    note,
    at: new Date().toISOString(),
  };
}

function buildConditions(state: DemoState): Map<string, Condition> {
  const conditions = new Map<string, Condition>();
  const stockMap = computeStock(state);
  const productById = new Map(state.products.map((p) => [p.id, p]));

  for (const product of state.products) {
    if (!product.active) continue;
    const stock = stockMap.get(product.id);
    if (!stock) continue;
    const reorder = Math.max(1, product.reorderPoint);

    if (stock.onHand < -0.0005) {
      conditions.set(`NEGATIVE_STOCK:${product.id}`, {
        type: 'NEGATIVE_STOCK',
        severity: 'CRITICAL',
        entityType: 'PRODUCT',
        entityId: product.id,
        productId: product.id,
        title: `${product.name} has negative stock`,
        detail: `On hand is ${stock.onHand} ${product.baseUnit}. Investigate the source movement before further sales.`,
        value: Math.abs(Math.round(stock.onHand * product.cost)),
        ownerRole: 'stock',
      });
    }

    if (stock.sellable <= 0.0005 && stock.storageSellable <= 0.0005) {
      const onOrder = state.purchaseOrders
        .filter((po) => ['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status))
        .flatMap((po) => po.lines)
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + Math.max(0, line.qty - line.receivedQty), 0);
      conditions.set(`OUT_OF_STOCK:${product.id}`, {
        type: 'OUT_OF_STOCK',
        severity: 'CRITICAL',
        entityType: 'PRODUCT',
        entityId: product.id,
        productId: product.id,
        title: `${product.name} is out of stock`,
        detail:
          onOrder > 0
            ? `No sellable stock. ${onOrder} ${product.baseUnit} is on order.`
            : 'No sellable stock and nothing on order. Create a purchase order to replenish.',
        value: Math.round(reorder * product.cost),
        ownerRole: 'purchasing',
      });
    } else if (stock.sellable <= reorder) {
      conditions.set(`LOW_STOCK:${product.id}`, {
        type: 'LOW_STOCK',
        severity: stock.sellable <= reorder * 0.4 ? 'HIGH' : 'MEDIUM',
        entityType: 'PRODUCT',
        entityId: product.id,
        productId: product.id,
        title: `${product.name} is below its reorder point`,
        detail: `${stock.sellable} ${product.baseUnit} sellable against a reorder point of ${reorder}.`,
        value: Math.round(Math.max(0, reorder - stock.sellable) * product.cost),
        ownerRole: 'purchasing',
      });
    }

    const lastSale = state.movements.reduce<string | null>((latest, m) => {
      if (m.productId !== product.id || m.type !== 'SALE') return latest;
      if (!latest || m.occurredAt > latest) return m.occurredAt;
      return latest;
    }, null);
    const noRecentSales =
      !lastSale || Date.now() - new Date(lastSale).getTime() > 45 * 86_400_000;
    if (noRecentSales && stock.onHand > 0 && stock.onHand * product.cost >= 500_000) {
      conditions.set(`SLOW_MOVING:${product.id}`, {
        type: 'SLOW_MOVING',
        severity: 'LOW',
        entityType: 'PRODUCT',
        entityId: product.id,
        productId: product.id,
        title: `${product.name} has not sold in 45 days`,
        detail: `${stock.onHand} ${product.baseUnit} on hand. Consider markdown, transfer or delisting.`,
        value: Math.round(stock.onHand * product.cost),
        ownerRole: 'stock',
      });
    }

    for (const batch of stock.batches) {
      if (batch.qty <= 0.0005) continue;
      if (!batch.batch.expiry) continue;
      const days = daysUntil(batch.batch.expiry) ?? 0;
      const warning = product.expiryWarningDays || state.settings.expiryWarningDays;

      if ((batch.status === 'SELLABLE' && days < 0) || batch.status === 'EXPIRED') {
        conditions.set(`EXPIRED_STOCK:${batch.batchId}`, {
          type: 'EXPIRED_STOCK',
          severity: 'CRITICAL',
          entityType: 'BATCH',
          entityId: batch.batchId,
          productId: product.id,
          title: `Expired stock: ${product.name}`,
          detail: `Batch ${batch.batch.batchNo} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. ${batch.qty} ${product.baseUnit} must be written off or disposed of.`,
          value: Math.round(batch.qty * product.cost),
          ownerRole: 'stock',
        });
      } else if (batch.status === 'SELLABLE' && days <= warning) {
        conditions.set(`NEAR_EXPIRY:${batch.batchId}`, {
          type: 'NEAR_EXPIRY',
          severity: days <= 3 ? 'HIGH' : 'MEDIUM',
          entityType: 'BATCH',
          entityId: batch.batchId,
          productId: product.id,
          title: `${product.name} expires in ${days} day${days === 1 ? '' : 's'}`,
          detail: `Batch ${batch.batch.batchNo} · ${batch.qty} ${product.baseUnit} at risk. Prioritise FEFO pick or markdown.`,
          value: Math.round(batch.qty * product.cost),
          ownerRole: 'stock',
        });
      }
    }
  }

  const pending =
    state.movements.filter((m) => m.sync === 'PENDING').length +
    state.sales.filter((s) => s.sync === 'PENDING').length +
    state.receipts.filter((r) => r.sync === 'PENDING').length;
  if (pending > 0) {
    conditions.set('SYNC_FAILURE:DEVICE', {
      type: 'SYNC_FAILURE',
      severity: 'HIGH',
      entityType: 'SYSTEM',
      entityId: 'DEVICE',
      productId: null,
      title: `${pending} document${pending === 1 ? '' : 's'} waiting to sync`,
      detail: 'Local changes are saved on this device but not yet acknowledged by the central service.',
      value: 0,
      ownerRole: 'manager',
    });
  }

  return conditions;
}

/**
 * Reconciles active alerts with current stock, expiry and sync conditions.
 * Deduplicates one active alert per type and entity, auto-resolves cleared
 * conditions, and reopens an alert only when its condition recurs.
 */
export function syncAlerts(state: DemoState, now = new Date()): void {
  const conditions = buildConditions(state);
  const nowIso = now.toISOString();
  const existingKeys = new Set<string>();

  for (const alert of state.alerts) {
    const key = `${alert.type}:${alert.entityId}`;
    existingKeys.add(key);
    const condition = conditions.get(key);

    if (alert.state === 'SNOOZED' && alert.snoozedUntil && alert.snoozedUntil <= nowIso) {
      alert.state = 'OPEN';
      alert.snoozedUntil = null;
      alert.history.push(systemAction('Snooze expired', 'Alert returned to the work queue.'));
      alert.updatedAt = nowIso;
    }

    if (condition) {
      alert.conditionSeen = true;
      alert.title = condition.title;
      alert.detail = condition.detail;
      alert.value = condition.value;
      alert.severity = condition.severity;
      alert.updatedAt = nowIso;
      if (alert.state === 'RESOLVED' && !alert.dismissUntilClear) {
        alert.state = 'OPEN';
        alert.resolvedAt = null;
        alert.detectedAt = nowIso;
        alert.history.push(systemAction('Condition recurred', 'A new occurrence of this alert was opened.'));
      }
    } else {
      if (alert.conditionSeen) {
        alert.conditionSeen = false;
        alert.dismissUntilClear = false;
        alert.updatedAt = nowIso;
      }
      if (alert.state !== 'RESOLVED') {
        alert.state = 'RESOLVED';
        alert.resolvedAt = nowIso;
        alert.updatedAt = nowIso;
        alert.history.push(systemAction('Auto-resolved', 'The underlying condition has cleared.'));
      }
    }
  }

  for (const [key, condition] of conditions) {
    if (existingKeys.has(key)) continue;
    const alert: Alert = {
      id: uid('alr'),
      type: condition.type,
      severity: condition.severity,
      entityType: condition.entityType,
      entityId: condition.entityId,
      productId: condition.productId,
      title: condition.title,
      detail: condition.detail,
      value: condition.value,
      state: 'OPEN',
      ownerRole: condition.ownerRole,
      detectedAt: nowIso,
      updatedAt: nowIso,
      snoozedUntil: null,
      resolvedAt: null,
      history: [
        {
          id: uid('act'),
          actorId: 'system',
          actorName: 'System',
          action: 'Detected',
          note: condition.detail,
          at: nowIso,
        },
      ],
      dismissUntilClear: false,
      conditionSeen: true,
    };
    state.alerts.push(alert);
  }
}

export function markAlert(
  state: DemoState,
  alertId: string,
  actorId: string,
  actorName: string,
  action: 'acknowledge' | 'snooze' | 'resolve' | 'reopen' | 'assign',
  note = '',
  snoozeHours = 24,
): void {
  const alert = state.alerts.find((a) => a.id === alertId);
  if (!alert) return;
  const at = new Date().toISOString();
  const entry = { id: uid('act'), actorId, actorName, action, note, at };
  alert.history.push(entry);
  alert.updatedAt = at;
  switch (action) {
    case 'acknowledge':
      alert.state = 'ACKNOWLEDGED';
      break;
    case 'snooze':
      alert.state = 'SNOOZED';
      alert.snoozedUntil = new Date(Date.now() + snoozeHours * 3_600_000).toISOString();
      break;
    case 'resolve':
      alert.state = 'RESOLVED';
      alert.resolvedAt = at;
      alert.dismissUntilClear = true;
      break;
    case 'reopen':
      alert.state = 'OPEN';
      alert.resolvedAt = null;
      alert.dismissUntilClear = false;
      break;
    case 'assign':
      alert.ownerRole = (note as Role) || alert.ownerRole;
      alert.state = 'ACKNOWLEDGED';
      break;
  }
}

export function raiseVarianceAlert(
  state: DemoState,
  countId: string,
  countNumber: string,
  value: number,
): void {
  const key = `LARGE_VARIANCE:${countId}`;
  if (state.alerts.some((a) => `${a.type}:${a.entityId}` === key)) return;
  const now = new Date().toISOString();
  state.alerts.push({
    id: uid('alr'),
    type: 'LARGE_VARIANCE',
    severity: 'HIGH',
    entityType: 'COUNT',
    entityId: countId,
    productId: null,
    title: `Count ${countNumber} has a large variance`,
    detail: `Variance value ${value} exceeds the approval threshold and needs a recount.`,
    value,
    state: 'OPEN',
    ownerRole: 'manager',
    detectedAt: now,
    updatedAt: now,
    snoozedUntil: null,
    resolvedAt: null,
    history: [
      {
        id: uid('act'),
        actorId: 'system',
        actorName: 'System',
        action: 'Detected',
        note: 'Count submitted above the variance threshold.',
        at: now,
      },
    ],
    dismissUntilClear: false,
    conditionSeen: true,
  });
}

export const ACTIVE_ALERT_STATES: Alert['state'][] = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];
