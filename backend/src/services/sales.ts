import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import type { Database, Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { nextDocumentNumber } from '../numbering.js';
import type { AuthUser } from '../types.js';

export type SalePayment = 'CASH' | 'TRANSFER' | 'CREDIT';

export interface SaleLineInput {
  productId: string;
  qty: number;
}

export interface CreateSaleInput {
  id: string;
  lines: SaleLineInput[];
  discountKobo?: number;
  payment: SalePayment;
  customerName?: string | null;
  deviceId: string;
  occurredAt?: string;
}

export interface SaleLineDto {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  batchId: string | null;
  qty: number;
  unitPriceKobo: number;
  unitCostKobo: number;
  returnedQty: number;
}

export interface SaleDto {
  id: string;
  number: string;
  status: string;
  subtotalKobo: number;
  discountKobo: number;
  totalKobo: number;
  payment: SalePayment;
  customerName: string | null;
  deviceId: string;
  cashierId: string;
  cashierName: string;
  occurredAt: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  lines: SaleLineDto[];
}

export interface SaleSummaryDto {
  id: string;
  number: string;
  status: string;
  totalKobo: number;
  payment: SalePayment;
  customerName: string | null;
  cashierName: string;
  lineCount: number;
  occurredAt: string;
}

interface SaleRow {
  id: string;
  number: string;
  status: string;
  subtotal_kobo: string;
  discount_kobo: string;
  total_kobo: string;
  payment: SalePayment;
  customer_name: string | null;
  device_id: string;
  cashier_id: string;
  cashier_name: string;
  occurred_at: Date | string;
  created_at: Date | string;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
}

interface SaleLineRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string | null;
  qty: string;
  unit_price_kobo: string;
  unit_cost_kobo: string;
  returned_qty: string;
}

interface ProductRow {
  id: string;
  name: string;
  price_kobo: string;
  cost_kobo: string;
}

interface AllocationRow {
  batch_id: string;
  location_id: string;
  qty: string;
  expiry: string | null;
  received_at: Date | string;
}

const toIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

const toNumber = (value: string | number): number => Number(value);

async function loadSale(querier: Queryable, storeId: string, saleId: string): Promise<SaleDto | null> {
  const { rows } = await querier.query<SaleRow>(
    `select s.id, s.number, s.status, s.subtotal_kobo::text, s.discount_kobo::text,
            s.total_kobo::text, s.payment, s.customer_name, s.device_id, s.cashier_id,
            u.name as cashier_name, s.occurred_at, s.created_at, s.voided_at,
            s.voided_by, s.void_reason
     from sales s
     join users u on u.id = s.cashier_id
     where s.id = $1 and s.store_id = $2`,
    [saleId, storeId],
  );
  const sale = rows[0];
  if (!sale) return null;

  const { rows: lines } = await querier.query<SaleLineRow>(
    `select sl.id, sl.product_id, p.sku, p.name as product_name, sl.batch_id,
            sl.qty::text, sl.unit_price_kobo::text, sl.unit_cost_kobo::text,
            sl.returned_qty::text
     from sale_lines sl
     join products p on p.id = sl.product_id
     where sl.sale_id = $1
     order by p.name, sl.id`,
    [saleId],
  );

  return {
    id: sale.id,
    number: sale.number,
    status: sale.status,
    subtotalKobo: toNumber(sale.subtotal_kobo),
    discountKobo: toNumber(sale.discount_kobo),
    totalKobo: toNumber(sale.total_kobo),
    payment: sale.payment,
    customerName: sale.customer_name,
    deviceId: sale.device_id,
    cashierId: sale.cashier_id,
    cashierName: sale.cashier_name,
    occurredAt: toIso(sale.occurred_at),
    createdAt: toIso(sale.created_at),
    voidedAt: sale.voided_at === null ? null : toIso(sale.voided_at),
    voidedBy: sale.voided_by,
    voidReason: sale.void_reason,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product_id,
      sku: line.sku,
      productName: line.product_name,
      batchId: line.batch_id,
      qty: toNumber(line.qty),
      unitPriceKobo: toNumber(line.unit_price_kobo),
      unitCostKobo: toNumber(line.unit_cost_kobo),
      returnedQty: toNumber(line.returned_qty),
    })),
  };
}

function mergeLines(lines: SaleLineInput[]): SaleLineInput[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw new ApiError(422, 'INVALID_QUANTITY', 'Sale quantities must be greater than zero.');
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.qty);
  }
  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty: Math.round(qty * 1000) / 1000 }));
}

export async function createSale(
  db: Database,
  actor: AuthUser,
  input: CreateSaleInput,
): Promise<{ sale: SaleDto; replayed: boolean }> {
  const existing = await loadSale(db, actor.storeId, input.id);
  if (existing) return { sale: existing, replayed: true };

  const lines = mergeLines(input.lines);
  if (lines.length === 0) {
    throw new ApiError(422, 'EMPTY_SALE', 'A sale needs at least one line.');
  }

  const sale = await db.transaction(async (tx) => {
    const productIds = lines.map((line) => line.productId).sort();
    const { rows: products } = await tx.query<ProductRow>(
      `select id, name, price_kobo::text, cost_kobo::text
       from products
       where store_id = $1 and id = any($2::uuid[])
       order by id
       for update`,
      [actor.storeId, productIds],
    );

    if (products.length !== productIds.length) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not exist in this store.');
    }

    const productById = new Map(products.map((product) => [product.id, product]));
    const subtotalKobo = lines.reduce((sum, line) => {
      const product = productById.get(line.productId);
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not exist.');
      return sum + Math.round(line.qty * toNumber(product.price_kobo));
    }, 0);

    const discountKobo = input.discountKobo ?? 0;
    if (discountKobo < 0 || discountKobo > subtotalKobo) {
      throw new ApiError(422, 'DISCOUNT_INVALID', 'The discount must be between zero and the subtotal.');
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const number = await nextDocumentNumber(tx, actor.storeId, 'SALE', 'S');
    const saleId = input.id;

    await tx.query(
      `insert into sales
         (id, store_id, number, subtotal_kobo, discount_kobo, total_kobo, payment,
          status, customer_name, device_id, cashier_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, $10, $11)`,
      [
        saleId,
        actor.storeId,
        number,
        subtotalKobo,
        discountKobo,
        subtotalKobo - discountKobo,
        input.payment,
        input.customerName ?? null,
        input.deviceId,
        actor.id,
        occurredAt,
      ],
    );

    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not exist.');

      const { rows: allocations } = await tx.query<AllocationRow>(
        `select sl.batch_id, sl.location_id, sum(sl.qty)::text as qty,
                b.expiry::text as expiry, b.received_at
         from stock_levels sl
         join batches b on b.id = sl.batch_id
         join locations l on l.id = sl.location_id
         where sl.store_id = $1 and sl.product_id = $2 and sl.status = 'SELLABLE'
           and sl.qty > 0 and l.selling_allowed and l.active
         group by sl.batch_id, sl.location_id, b.expiry, b.received_at
         order by b.expiry asc nulls last, b.received_at asc, sl.batch_id asc, sl.location_id asc`,
        [actor.storeId, line.productId],
      );

      const available = allocations.reduce((sum, allocation) => sum + toNumber(allocation.qty), 0);
      if (available < line.qty) {
        throw new ApiError(
          409,
          'INSUFFICIENT_STOCK',
          `Not enough sellable stock for ${product.name}. Requested ${line.qty}, available ${available}.`,
        );
      }

      const unitPriceKobo = toNumber(product.price_kobo);
      const unitCostKobo = toNumber(product.cost_kobo);

      await tx.query(
        `insert into sale_lines
           (id, sale_id, product_id, batch_id, qty, unit_price_kobo, unit_cost_kobo)
         values ($1, $2, $3, null, $4, $5, $6)`,
        [randomUUID(), saleId, line.productId, line.qty, unitPriceKobo, unitCostKobo],
      );

      let remaining = line.qty;
      for (const allocation of allocations) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, toNumber(allocation.qty));
        remaining = Math.round((remaining - take) * 1000) / 1000;

        await tx.query(
          `insert into stock_movements
             (id, store_id, type, product_id, batch_id, qty,
              from_location_id, from_status, unit_cost_kobo, ref_type, ref_id,
              actor_id, occurred_at, device_id)
           values ($1, $2, 'SALE', $3, $4, $5, $6, 'SELLABLE', $7, 'SALE', $8, $9, $10, $11)`,
          [
            randomUUID(),
            actor.storeId,
            line.productId,
            allocation.batch_id,
            take,
            allocation.location_id,
            unitCostKobo,
            saleId,
            actor.id,
            occurredAt,
            input.deviceId,
          ],
        );
      }
    }

    await appendAudit(tx, {
      storeId: actor.storeId,
      actor,
      action: 'SALE_CREATED',
      entityType: 'SALE',
      entityId: saleId,
      summary: `Completed sale ${number} for ${subtotalKobo - discountKobo} kobo.`,
      after: {
        number,
        lines: lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          unitPriceKobo: toNumber(productById.get(line.productId)?.price_kobo ?? '0'),
        })),
        subtotalKobo,
        discountKobo,
        totalKobo: subtotalKobo - discountKobo,
        payment: input.payment,
      },
    });

    const created = await loadSale(tx, actor.storeId, saleId);
    if (!created) throw new Error('The sale was written but could not be reloaded.');
    return created;
  });

  return { sale, replayed: false };
}

export async function listSales(db: Database, storeId: string, limit: number): Promise<SaleSummaryDto[]> {
  const { rows } = await db.query<{
    id: string;
    number: string;
    status: string;
    total_kobo: string;
    payment: SalePayment;
    customer_name: string | null;
    cashier_name: string;
    line_count: number;
    occurred_at: Date | string;
  }>(
    `select s.id, s.number, s.status, s.total_kobo::text, s.payment, s.customer_name,
            u.name as cashier_name,
            (select count(*)::int from sale_lines sl where sl.sale_id = s.id) as line_count,
            s.occurred_at
     from sales s
     join users u on u.id = s.cashier_id
     where s.store_id = $1
     order by s.occurred_at desc, s.created_at desc
     limit $2`,
    [storeId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    totalKobo: toNumber(row.total_kobo),
    payment: row.payment,
    customerName: row.customer_name,
    cashierName: row.cashier_name,
    lineCount: row.line_count,
    occurredAt: toIso(row.occurred_at),
  }));
}

export function getSale(db: Database, storeId: string, saleId: string): Promise<SaleDto | null> {
  return loadSale(db, storeId, saleId);
}

export async function voidSale(
  db: Database,
  actor: AuthUser,
  saleId: string,
  reason: string,
  deviceId: string,
): Promise<SaleDto> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; number: string; status: string }>(
      `select id, number, status from sales
       where id = $1 and store_id = $2
       for update`,
      [saleId, actor.storeId],
    );
    const sale = rows[0];
    if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND', 'Sale not found.');
    if (sale.status !== 'COMPLETED') {
      throw new ApiError(409, 'SALE_NOT_VOIDABLE', 'Only completed sales can be voided.');
    }

    const { rows: movements } = await tx.query<{
      product_id: string;
      batch_id: string;
      qty: string;
      from_location_id: string;
      from_status: string;
      unit_cost_kobo: string;
    }>(
      `select product_id, batch_id, qty::text, from_location_id, from_status, unit_cost_kobo::text
       from stock_movements
       where ref_type = 'SALE' and ref_id = $1 and store_id = $2 and type = 'SALE'
       order by seq`,
      [saleId, actor.storeId],
    );

    const voidedAt = new Date().toISOString();
    for (const movement of movements) {
      await tx.query(
        `insert into stock_movements
           (id, store_id, type, product_id, batch_id, qty,
            to_location_id, to_status, unit_cost_kobo, ref_type, ref_id,
            actor_id, occurred_at, device_id, reason)
         values ($1, $2, 'VOID', $3, $4, $5, $6, $7, $8, 'SALE', $9, $10, $11, $12, $13)`,
        [
          randomUUID(),
          actor.storeId,
          movement.product_id,
          movement.batch_id,
          movement.qty,
          movement.from_location_id,
          movement.from_status,
          movement.unit_cost_kobo,
          saleId,
          actor.id,
          voidedAt,
          deviceId,
          reason,
        ],
      );
    }

    await tx.query(
      `update sales
       set status = 'VOIDED', voided_at = $1, voided_by = $2, void_reason = $3
       where id = $4 and store_id = $5`,
      [voidedAt, actor.id, reason, saleId, actor.storeId],
    );

    await appendAudit(tx, {
      storeId: actor.storeId,
      actor,
      action: 'SALE_VOIDED',
      entityType: 'SALE',
      entityId: saleId,
      summary: `Voided sale ${sale.number}.`,
      before: { status: sale.status },
      after: { status: 'VOIDED', voidedAt },
      reason,
    });

    const voided = await loadSale(tx, actor.storeId, saleId);
    if (!voided) throw new Error('The sale was voided but could not be reloaded.');
    return voided;
  });
}
