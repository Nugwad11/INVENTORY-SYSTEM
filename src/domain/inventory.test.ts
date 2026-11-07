import { describe, expect, it } from 'vitest';
import type {
  Batch,
  DemoState,
  Location,
  Movement,
  Product,
  PurchaseOrder,
  Supplier,
} from '../types';
import {
  allocateFefo,
  averageCostAfterReceipt,
  computeBalances,
  computeStock,
  computeStockValue,
  reorderSuggestion,
  sellableBatches,
  stockFor,
} from './inventory';
import { createSeedState } from '../data/seed';

const NOW = new Date('2026-11-07T10:00:00.000Z');

function iso(offsetDays: number, hour = 10): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const locations: Location[] = [
  { id: 'shop', name: 'Shop Floor', type: 'SELLING', sellingAllowed: true, active: true },
  { id: 'store', name: 'Back Store', type: 'STORAGE', sellingAllowed: false, active: true },
  { id: 'damaged', name: 'Damaged', type: 'DAMAGED', sellingAllowed: false, active: true },
];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'SKU-1',
    name: 'Test Milk 1L',
    brand: 'Test',
    categoryId: 'cat-dairy',
    baseUnit: 'each',
    barcode: '1000000000001',
    packSize: 1,
    packLabel: 'each',
    cost: 10_000,
    price: 15_000,
    active: true,
    weighed: false,
    perishable: true,
    batchTracked: true,
    expiryWarningDays: 30,
    reorderPoint: 10,
    safetyStock: 5,
    reorderMultiple: 6,
    supplierId: 'sup-1',
    defaultLocationId: 'shop',
    ...overrides,
  };
}

function makeBatch(id: string, batchNo: string, expiry: string | null, productId = 'p1'): Batch {
  return { id, productId, batchNo, expiry, receivedAt: iso(-10), supplierId: 'sup-1' };
}

let sequence = 0;

function makeMovement(overrides: Partial<Movement> & Pick<Movement, 'batchId' | 'qty'>): Movement {
  sequence += 1;
  return {
    id: `mov-${sequence}`,
    seq: sequence,
    transactionId: `txn-${sequence}`,
    type: 'RECEIPT',
    productId: 'p1',
    from: null,
    to: { locationId: 'shop', status: 'SELLABLE' },
    unitCost: 10_000,
    value: Math.round(overrides.qty * 10_000),
    occurredAt: iso(-10),
    postedAt: iso(-10),
    refType: 'RECEIPT',
    refId: `doc-${sequence}`,
    actorId: 'usr-owner',
    reason: null,
    note: null,
    sync: 'SYNCED',
    ...overrides,
  };
}

const supplier: Supplier = {
  id: 'sup-1',
  name: 'Test Supplier',
  contactName: 'Test Contact',
  phone: '+234 800 000 0000',
  email: 'orders@test.local',
  leadTimeDays: 3,
  reviewDays: 2,
  paymentTerms: 'Net 7',
  minOrder: 0,
  active: true,
};

function makeState(overrides: Partial<DemoState>): DemoState {
  const seed = createSeedState();
  return {
    ...seed,
    products: [makeProduct()],
    locations,
    batches: [],
    movements: [],
    purchaseOrders: [],
    sales: [],
    suppliers: [supplier],
    ...overrides,
  };
}

describe('ledger balances', () => {
  it('nets receipts and sales for the same batch and location', () => {
    const batches = [makeBatch('b1', 'LOT-1', iso(30))];
    const movements = [
      makeMovement({ batchId: 'b1', qty: 10 }),
      makeMovement({
        batchId: 'b1',
        qty: 3,
        type: 'SALE',
        from: { locationId: 'shop', status: 'SELLABLE' },
        to: null,
        refType: 'SALE',
      }),
    ];

    const balances = computeBalances(movements);
    expect(balances).toHaveLength(1);
    expect(balances[0].qty).toBe(7);

    const stock = stockFor(computeStock({ products: [makeProduct()], locations, batches, movements }), 'p1');
    expect(stock.onHand).toBe(7);
    expect(stock.sellable).toBe(7);
    expect(stock.signedAvailable).toBe(7);
  });

  it('moves quantity between locations without changing on hand', () => {
    const batches = [makeBatch('b1', 'LOT-1', iso(30))];
    const movements = [
      makeMovement({ batchId: 'b1', qty: 10 }),
      makeMovement({
        batchId: 'b1',
        qty: 4,
        type: 'TRANSFER',
        from: { locationId: 'shop', status: 'SELLABLE' },
        to: { locationId: 'store', status: 'SELLABLE' },
        refType: 'TRANSFER',
      }),
    ];

    const stock = stockFor(computeStock({ products: [makeProduct()], locations, batches, movements }), 'p1');
    expect(stock.onHand).toBe(10);
    expect(stock.sellable).toBe(6);
    expect(stock.storageSellable).toBe(4);
  });

  it('keeps non-sellable stock inside on hand but outside sellable', () => {
    const batches = [makeBatch('b1', 'LOT-1', iso(30))];
    const movements = [
      makeMovement({ batchId: 'b1', qty: 10 }),
      makeMovement({
        batchId: 'b1',
        qty: 2,
        type: 'STATUS_CHANGE',
        from: { locationId: 'shop', status: 'SELLABLE' },
        to: { locationId: 'damaged', status: 'DAMAGED' },
        refType: 'ADJUSTMENT',
      }),
    ];

    const stock = stockFor(computeStock({ products: [makeProduct()], locations, batches, movements }), 'p1');
    expect(stock.onHand).toBe(10);
    expect(stock.sellable).toBe(8);
    expect(stock.nonSellable).toBe(2);
  });

  it('flags negative balances when sales exceed receipts', () => {
    const batches = [makeBatch('b1', 'LOT-1', iso(30))];
    const movements = [
      makeMovement({
        batchId: 'b1',
        qty: 2,
        type: 'SALE',
        from: { locationId: 'shop', status: 'SELLABLE' },
        to: null,
        refType: 'SALE',
      }),
    ];

    const stock = stockFor(computeStock({ products: [makeProduct()], locations, batches, movements }), 'p1');
    expect(stock.onHand).toBe(-2);
    expect(stock.sellable).toBe(-2);
    expect(stock.signedAvailable).toBe(-2);
    expect(stock.available).toBe(0);
  });
});

describe('FEFO allocation', () => {
  const batches = [
    makeBatch('b1', 'LOT-5D', iso(5)),
    makeBatch('b2', 'LOT-1D', iso(1)),
    makeBatch('b3', 'LOT-EXPIRED', iso(-1)),
    makeBatch('b4', 'LOT-NO-EXPIRY', null),
  ];
  const movements = [
    makeMovement({ batchId: 'b1', qty: 10 }),
    makeMovement({ batchId: 'b2', qty: 5 }),
    makeMovement({ batchId: 'b3', qty: 4 }),
    makeMovement({ batchId: 'b4', qty: 20 }),
  ];
  const stock = stockFor(
    computeStock({ products: [makeProduct()], locations, batches, movements }),
    'p1',
  );

  it('sorts by expiry with non-expiring stock last', () => {
    expect(sellableBatches(stock, 'shop').map((batch) => batch.batchId)).toEqual(['b2', 'b1', 'b4']);
  });

  it('picks the earliest expiring batches first and excludes expired stock', () => {
    const result = allocateFefo(stock, 'shop', 12);
    expect(result.shortfall).toBe(0);
    expect(result.allocations).toEqual([
      { batchId: 'b2', qty: 5 },
      { batchId: 'b1', qty: 7 },
    ]);
  });

  it('reports shortfall rather than defaulting to a negative balance', () => {
    const result = allocateFefo(stock, 'shop', 40);
    expect(result.allocations.reduce((sum, line) => sum + line.qty, 0)).toBe(35);
    expect(result.shortfall).toBe(5);
  });

  it('can include expired batches when a supervisor explicitly allows it', () => {
    const result = allocateFefo(stock, 'shop', 40, true);
    expect(result.allocations[0]).toEqual({ batchId: 'b3', qty: 4 });
    expect(result.shortfall).toBe(1);
  });
});

describe('weighted moving average cost', () => {
  it('weights existing stock and the accepted receipt', () => {
    expect(averageCostAfterReceipt(10, 10_000, 10, 15_000)).toBe(12_500);
  });

  it('adopts the receipt cost when there is no stock on hand', () => {
    expect(averageCostAfterReceipt(0, 10_000, 8, 13_000)).toBe(13_000);
  });

  it('leaves cost unchanged when nothing was accepted', () => {
    expect(averageCostAfterReceipt(10, 10_000, 0, 99_000)).toBe(10_000);
  });
});

describe('reorder suggestion', () => {
  function stateWithDemand(onOrderStatus: 'APPROVED' | 'PENDING_APPROVAL' | null = null): DemoState {
    const movements = [
      makeMovement({ batchId: 'b1', qty: 32 }),
      makeMovement({
        batchId: 'b1',
        qty: 28,
        type: 'SALE',
        from: { locationId: 'shop', status: 'SELLABLE' },
        to: null,
        refType: 'SALE',
        occurredAt: iso(-1),
      }),
    ];
    const purchaseOrders: PurchaseOrder[] = onOrderStatus
      ? [
          {
            id: 'po-1',
            number: 'PO-00001',
            supplierId: 'sup-1',
            status: onOrderStatus,
            lines: [{ id: 'pol-1', productId: 'p1', qty: 5, receivedQty: 0, unitCost: 10_000 }],
            expectedDate: iso(5),
            notes: '',
            version: 1,
            createdBy: 'usr-manager',
            createdAt: iso(-1),
            submittedAt: iso(-1),
            approvedAt: null,
            sentAt: null,
            closedAt: null,
            closeReason: null,
            approvals: [],
          },
        ]
      : [];
    return makeState({
      batches: [makeBatch('b1', 'LOT-1', iso(30))],
      movements,
      purchaseOrders,
    });
  }

  it('builds a forecast-based reorder point and rounds the order to the pack multiple', () => {
    const state = stateWithDemand();
    const stock = stockFor(computeStock(state), 'p1');
    const suggestion = reorderSuggestion(state, state.products[0], stock, NOW, 28);

    expect(suggestion.avgDailyDemand).toBeCloseTo(1, 5);
    expect(suggestion.reorderPoint).toBe(10);
    expect(suggestion.available).toBe(4);
    expect(suggestion.onOrder).toBe(0);
    expect(suggestion.need).toBe(6);
    expect(suggestion.suggestedQty).toBe(6);
    expect(suggestion.status).toBe('LOW');
  });

  it('subtracts approved on-order quantity but ignores orders awaiting approval', () => {
    const approved = stateWithDemand('APPROVED');
    const approvedStock = stockFor(computeStock(approved), 'p1');
    const approvedSuggestion = reorderSuggestion(approved, approved.products[0], approvedStock, NOW, 28);
    expect(approvedSuggestion.onOrder).toBe(5);
    expect(approvedSuggestion.need).toBe(1);
    expect(approvedSuggestion.suggestedQty).toBe(6);

    const pending = stateWithDemand('PENDING_APPROVAL');
    const pendingStock = stockFor(computeStock(pending), 'p1');
    const pendingSuggestion = reorderSuggestion(pending, pending.products[0], pendingStock, NOW, 28);
    expect(pendingSuggestion.onOrder).toBe(0);
    expect(pendingSuggestion.suggestedQty).toBe(6);
  });

  it('falls back to the manual rule when there is no sales history', () => {
    const state = makeState({
      batches: [makeBatch('b1', 'LOT-1', iso(30))],
      movements: [makeMovement({ batchId: 'b1', qty: 4 })],
    });
    const stock = stockFor(computeStock(state), 'p1');
    const suggestion = reorderSuggestion(state, state.products[0], stock, NOW, 28);
    expect(suggestion.manualRule).toBe(true);
    expect(suggestion.reorderPoint).toBe(10);
    expect(suggestion.status).toBe('LOW');
  });
});

describe('stock valuation', () => {
  it('values sellable stock at cost and retail without mixing units and money', () => {
    const state = makeState({
      batches: [makeBatch('b1', 'LOT-1', iso(30))],
      movements: [makeMovement({ batchId: 'b1', qty: 10 })],
    });
    const summary = computeStockValue(state);

    expect(summary.sellableUnits).toBe(10);
    expect(summary.onHandUnits).toBe(10);
    expect(summary.totalCostValue).toBe(100_000);
    expect(summary.retailValue).toBe(150_000);
    expect(summary.marginValue).toBe(50_000);
    expect(summary.expiredUnits).toBe(0);
    expect(summary.expiredValue).toBe(0);
    expect(summary.skuCount).toBe(1);
  });

  it('excludes date-expired stock from sellable and values it separately', () => {
    const batches = [makeBatch('b1', 'LOT-FRESH', iso(30)), makeBatch('b2', 'LOT-EXPIRED', iso(-1))];
    const movements = [
      makeMovement({ batchId: 'b1', qty: 10 }),
      makeMovement({ batchId: 'b2', qty: 2 }),
    ];
    const state = makeState({ batches, movements });
    const stock = stockFor(computeStock(state), 'p1');

    expect(stock.onHand).toBe(12);
    expect(stock.sellable).toBe(10);
    expect(stock.nonSellable).toBe(2);
    expect(stock.expired).toBe(2);
    expect(allocateFefo(stock, 'shop', 12).shortfall).toBe(2);

    const summary = computeStockValue(state);
    expect(summary.sellableUnits).toBe(10);
    expect(summary.expiredUnits).toBe(2);
    expect(summary.expiredValue).toBe(20_000);
  });
});
