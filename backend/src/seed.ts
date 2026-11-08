import { randomUUID } from 'node:crypto';
import { appendAudit } from './audit.js';
import { hashPassword } from './auth.js';
import type { Database, Queryable } from './db.js';
import type { AuthUser } from './types.js';

export const SEED_IDS = {
  store: '00000000-0000-4000-8000-000000000001',
  owner: '00000000-0000-4000-8000-000000000002',
  manager: '00000000-0000-4000-8000-000000000003',
  cashier: '00000000-0000-4000-8000-000000000004',
  sellingLocation: '00000000-0000-4000-8000-000000000010',
  storageLocation: '00000000-0000-4000-8000-000000000011',
  damagedLocation: '00000000-0000-4000-8000-000000000012',
  supplier: '00000000-0000-4000-8000-000000000020',
  milk: '00000000-0000-4000-8000-000000000030',
  rice: '00000000-0000-4000-8000-000000000031',
  milkBatchA: '00000000-0000-4000-8000-000000000040',
  milkBatchB: '00000000-0000-4000-8000-000000000041',
  riceBatch: '00000000-0000-4000-8000-000000000042',
} as const;

interface MovementInput {
  type: string;
  productId: string;
  batchId: string;
  qty: number;
  fromLocationId?: string;
  toLocationId?: string;
  unitCostKobo: number;
  refType: string;
  actorId: string;
}

async function insertMovement(tx: Queryable, storeId: string, movement: MovementInput): Promise<void> {
  await tx.query(
    `insert into stock_movements
       (id, store_id, type, product_id, batch_id, qty,
        from_location_id, from_status, to_location_id, to_status,
        unit_cost_kobo, ref_type, actor_id, occurred_at, device_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), 'SEED')`,
    [
      randomUUID(),
      storeId,
      movement.type,
      movement.productId,
      movement.batchId,
      movement.qty,
      movement.fromLocationId ?? null,
      movement.fromLocationId ? 'SELLABLE' : null,
      movement.toLocationId ?? null,
      movement.toLocationId ? 'SELLABLE' : null,
      movement.unitCostKobo,
      movement.refType,
      movement.actorId,
    ],
  );
}

export async function seedDatabase(db: Database, password: string): Promise<{ skipped: boolean }> {
  const existing = await db.query('select id from stores where code = $1', ['GF-LEK-01']);
  if (existing.rows.length > 0) return { skipped: true };

  const passwordHash = await hashPassword(password);
  const actor: AuthUser = {
    id: SEED_IDS.owner,
    storeId: SEED_IDS.store,
    name: 'David Akwu',
    role: 'owner',
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `insert into stores (id, name, code, timezone, currency, address, trading_day_cutoff, settings)
       values ($1, $2, $3, 'Africa/Lagos', 'NGN', $4, '00:00', $5)`,
      [
        SEED_IDS.store,
        'Greenfield Supermarket',
        'GF-LEK-01',
        '12 Admiralty Way, Lekki, Lagos',
        JSON.stringify({
          approvalLimitManagerKobo: 50_000_000,
          approvalLimitOwnerKobo: 200_000_000,
          receiptTolerancePct: 2,
          negativeStockAllowed: false,
          countVarianceThreshold: 1,
          lowStockWindowDays: 7,
          expiryWarningDays: 14,
          autoLockDays: 30,
        }),
      ],
    );

    await tx.query(
      `insert into locations (id, store_id, name, type, selling_allowed) values
         ($1, $4, 'Shop floor', 'SELLING', true),
         ($2, $4, 'Store room', 'STORAGE', false),
         ($3, $4, 'Damaged cage', 'DAMAGED', false)`,
      [SEED_IDS.sellingLocation, SEED_IDS.storageLocation, SEED_IDS.damagedLocation, SEED_IDS.store],
    );

    await tx.query(
      `insert into users (id, store_id, name, role, phone, password_hash, must_change_password) values
         ($1, $4, 'David Akwu', 'owner', '+2348030001001', $5, false),
         ($2, $4, 'Ngozi Okafor', 'manager', '+2348030001002', $5, false),
         ($3, $4, 'Chinedu Obi', 'cashier', '+2348030001006', $5, false)`,
      [SEED_IDS.owner, SEED_IDS.manager, SEED_IDS.cashier, SEED_IDS.store, passwordHash],
    );

    await tx.query(
      `insert into suppliers (id, store_id, name, contact_name, phone, email, lead_time_days, payment_terms, min_order_kobo)
       values ($1, $2, 'Lagos Wholesale Ltd', 'Bola Ade', '+2348020000001', 'orders@lagoswholesale.example',
               3, 'Net 14', 5000000)`,
      [SEED_IDS.supplier, SEED_IDS.store],
    );

    await tx.query(
      `insert into products
         (id, store_id, sku, name, brand, category, barcode, base_unit, pack_size, pack_label,
          cost_kobo, price_kobo, batch_tracked, perishable, expiry_warning_days,
          reorder_point, safety_stock, reorder_multiple, supplier_id, default_location_id)
       values
         ($1, $3, 'BEV-001', 'Peak Full Cream Milk 400g', 'Peak', 'Beverages', '6151100010015',
          'each', 1, 'sachet', 100000, 150000, true, true, 14, 12, 6, 6, $4, $5),
         ($2, $3, 'STA-001', 'Mama Gold Rice 5kg', 'Mama Gold', 'Staples', '6151100010022',
          'each', 1, 'bag', 650000, 850000, true, false, 0, 8, 4, 4, $4, $5)`,
      [SEED_IDS.milk, SEED_IDS.rice, SEED_IDS.store, SEED_IDS.supplier, SEED_IDS.storageLocation],
    );

    await tx.query(
      `insert into batches (id, product_id, batch_no, expiry, received_at, supplier_id) values
         ($1, $4, 'MILK-2609', '2027-01-31', now(), $6),
         ($2, $4, 'MILK-2701', '2027-06-30', now(), $6),
         ($3, $5, 'RICE-2703', null, now(), $6)`,
      [
        SEED_IDS.milkBatchA,
        SEED_IDS.milkBatchB,
        SEED_IDS.riceBatch,
        SEED_IDS.milk,
        SEED_IDS.rice,
        SEED_IDS.supplier,
      ],
    );

    await insertMovement(tx, SEED_IDS.store, {
      type: 'OPENING',
      productId: SEED_IDS.milk,
      batchId: SEED_IDS.milkBatchA,
      qty: 10,
      toLocationId: SEED_IDS.storageLocation,
      unitCostKobo: 100000,
      refType: 'OPENING',
      actorId: SEED_IDS.owner,
    });
    await insertMovement(tx, SEED_IDS.store, {
      type: 'OPENING',
      productId: SEED_IDS.milk,
      batchId: SEED_IDS.milkBatchB,
      qty: 14,
      toLocationId: SEED_IDS.storageLocation,
      unitCostKobo: 100000,
      refType: 'OPENING',
      actorId: SEED_IDS.owner,
    });
    await insertMovement(tx, SEED_IDS.store, {
      type: 'OPENING',
      productId: SEED_IDS.rice,
      batchId: SEED_IDS.riceBatch,
      qty: 20,
      toLocationId: SEED_IDS.storageLocation,
      unitCostKobo: 650000,
      refType: 'OPENING',
      actorId: SEED_IDS.owner,
    });

    await insertMovement(tx, SEED_IDS.store, {
      type: 'TRANSFER',
      productId: SEED_IDS.milk,
      batchId: SEED_IDS.milkBatchA,
      qty: 5,
      fromLocationId: SEED_IDS.storageLocation,
      toLocationId: SEED_IDS.sellingLocation,
      unitCostKobo: 100000,
      refType: 'TRANSFER',
      actorId: SEED_IDS.owner,
    });
    await insertMovement(tx, SEED_IDS.store, {
      type: 'TRANSFER',
      productId: SEED_IDS.milk,
      batchId: SEED_IDS.milkBatchB,
      qty: 7,
      fromLocationId: SEED_IDS.storageLocation,
      toLocationId: SEED_IDS.sellingLocation,
      unitCostKobo: 100000,
      refType: 'TRANSFER',
      actorId: SEED_IDS.owner,
    });
    await insertMovement(tx, SEED_IDS.store, {
      type: 'TRANSFER',
      productId: SEED_IDS.rice,
      batchId: SEED_IDS.riceBatch,
      qty: 10,
      fromLocationId: SEED_IDS.storageLocation,
      toLocationId: SEED_IDS.sellingLocation,
      unitCostKobo: 650000,
      refType: 'TRANSFER',
      actorId: SEED_IDS.owner,
    });

    await appendAudit(tx, {
      storeId: SEED_IDS.store,
      actor,
      action: 'DEMO_SEEDED',
      entityType: 'STORE',
      entityId: SEED_IDS.store,
      summary: 'Seeded the Greenfield demonstration store.',
    });
  });

  return { skipped: false };
}
