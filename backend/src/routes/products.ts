import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit.js';
import { createGuards } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import { ApiError } from '../errors.js';

const productColumns = `p.id, p.sku, p.name, p.brand, p.category, p.barcode,
  p.base_unit, p.pack_size::text, p.pack_label, p.cost_kobo::text, p.price_kobo::text,
  p.active, p.batch_tracked, p.perishable, p.expiry_warning_days,
  p.reorder_point::text, p.safety_stock::text, p.reorder_multiple::text,
  p.supplier_id, p.default_location_id`;

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  barcode: string | null;
  base_unit: string;
  pack_size: string;
  pack_label: string;
  cost_kobo: string;
  price_kobo: string;
  active: boolean;
  batch_tracked: boolean;
  perishable: boolean;
  expiry_warning_days: number;
  reorder_point: string;
  safety_stock: string;
  reorder_multiple: string;
  supplier_id: string | null;
  default_location_id: string | null;
}

type ProductWithStockRow = ProductRow & { selling_qty: string; total_qty: string };

function toProduct(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    category: row.category,
    barcode: row.barcode,
    baseUnit: row.base_unit,
    packSize: Number(row.pack_size),
    packLabel: row.pack_label,
    costKobo: Number(row.cost_kobo),
    priceKobo: Number(row.price_kobo),
    active: row.active,
    batchTracked: row.batch_tracked,
    perishable: row.perishable,
    expiryWarningDays: row.expiry_warning_days,
    reorderPoint: Number(row.reorder_point),
    safetyStock: Number(row.safety_stock),
    reorderMultiple: Number(row.reorder_multiple),
    supplierId: row.supplier_id,
    defaultLocationId: row.default_location_id,
  };
}

const productQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const stockQuerySchema = z.object({
  productId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  includeEmpty: z.coerce.boolean().default(false),
});

const createProductSchema = z.object({
  id: z.uuid().optional(),
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).default(''),
  category: z.string().trim().max(120).default(''),
  barcode: z.string().trim().max(64).optional(),
  baseUnit: z.enum(['each', 'kg', 'litre', 'metre']).default('each'),
  packSize: z.number().positive().default(1),
  packLabel: z.string().trim().max(64).default(''),
  costKobo: z.number().int().min(0).default(0),
  priceKobo: z.number().int().min(0).default(0),
  batchTracked: z.boolean().default(true),
  perishable: z.boolean().default(false),
  expiryWarningDays: z.number().int().min(0).default(0),
  reorderPoint: z.number().min(0).default(0),
  safetyStock: z.number().min(0).default(0),
  reorderMultiple: z.number().positive().default(1),
  supplierId: z.uuid().nullable().optional(),
  defaultLocationId: z.uuid().nullable().optional(),
});

export function registerProductRoutes(
  app: FastifyInstance,
  { config, db }: { config: AppConfig; db: Database },
): void {
  const guards = createGuards(db, config);
  const reader = guards.authenticate;
  const writer = guards.requireRoles('owner', 'manager', 'purchasing');

  app.get('/api/products', { preHandler: [reader] }, async (request) => {
    const query = productQuerySchema.parse(request.query);
    const { rows } = await db.query<ProductWithStockRow>(
      `select ${productColumns},
              coalesce(sum(case when sl.status = 'SELLABLE' and l.selling_allowed then sl.qty else 0 end), 0)::text as selling_qty,
              coalesce(sum(case when sl.status = 'SELLABLE' then sl.qty else 0 end), 0)::text as total_qty
       from products p
       left join stock_levels sl on sl.product_id = p.id and sl.store_id = p.store_id
       left join locations l on l.id = sl.location_id
       where p.store_id = $1
         and ($2::text is null or p.name ilike '%' || $2 || '%' or p.sku ilike '%' || $2 || '%')
       group by p.id
       order by p.name
       limit $3`,
      [request.user.storeId, query.search ?? null, query.limit],
    );

    return {
      products: rows.map((row) => ({
        ...toProduct(row),
        sellingQty: Number(row.selling_qty),
        totalQty: Number(row.total_qty),
      })),
    };
  });

  app.post('/api/products', { preHandler: [writer] }, async (request, reply) => {
    const actor = request.user;
    const body = createProductSchema.parse(request.body);

    const product = await db.transaction(async (tx) => {
      if (body.supplierId) {
        const { rows } = await tx.query('select 1 from suppliers where id = $1 and store_id = $2', [
          body.supplierId,
          actor.storeId,
        ]);
        if (rows.length === 0) throw new ApiError(422, 'SUPPLIER_NOT_FOUND', 'Supplier not found in this store.');
      }
      if (body.defaultLocationId) {
        const { rows } = await tx.query('select 1 from locations where id = $1 and store_id = $2', [
          body.defaultLocationId,
          actor.storeId,
        ]);
        if (rows.length === 0) throw new ApiError(422, 'LOCATION_NOT_FOUND', 'Location not found in this store.');
      }

      const { rows } = await tx.query<ProductRow>(
        `insert into products as p
           (id, store_id, sku, name, brand, category, barcode, base_unit, pack_size, pack_label,
            cost_kobo, price_kobo, batch_tracked, perishable, expiry_warning_days,
            reorder_point, safety_stock, reorder_multiple, supplier_id, default_location_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         returning ${productColumns}`,
        [
          body.id ?? randomUUID(),
          actor.storeId,
          body.sku,
          body.name,
          body.brand,
          body.category,
          body.barcode ?? null,
          body.baseUnit,
          body.packSize,
          body.packLabel,
          body.costKobo,
          body.priceKobo,
          body.batchTracked,
          body.perishable,
          body.expiryWarningDays,
          body.reorderPoint,
          body.safetyStock,
          body.reorderMultiple,
          body.supplierId ?? null,
          body.defaultLocationId ?? null,
        ],
      );
      const created = rows[0];
      if (!created) throw new Error('Failed to create the product.');

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'PRODUCT_CREATED',
        entityType: 'PRODUCT',
        entityId: created.id,
        summary: `Added product ${created.name} (${created.sku}).`,
        after: { sku: created.sku, name: created.name, priceKobo: Number(created.price_kobo) },
      });

      return created;
    });

    return reply.code(201).send({ product: toProduct(product) });
  });

  app.get('/api/stock', { preHandler: [reader] }, async (request) => {
    const query = stockQuerySchema.parse(request.query);
    const { rows } = await db.query<{
      product_id: string;
      sku: string;
      product_name: string;
      batch_id: string;
      batch_no: string;
      expiry: string | null;
      location_id: string;
      location_name: string;
      location_type: string;
      status: string;
      qty: string;
    }>(
      `select sl.product_id, p.sku, p.name as product_name, sl.batch_id, b.batch_no,
              b.expiry::text as expiry, sl.location_id, l.name as location_name,
              l.type as location_type, sl.status, sl.qty::text as qty
       from stock_levels sl
       join products p on p.id = sl.product_id
       join batches b on b.id = sl.batch_id
       join locations l on l.id = sl.location_id
       where sl.store_id = $1
         and ($2::uuid is null or sl.product_id = $2)
         and ($3::uuid is null or sl.location_id = $3)
         and ($4::boolean or sl.qty <> 0)
       order by p.name, b.expiry asc nulls last, l.name, sl.status`,
      [request.user.storeId, query.productId ?? null, query.locationId ?? null, query.includeEmpty],
    );

    return {
      stock: rows.map((row) => ({
        productId: row.product_id,
        sku: row.sku,
        productName: row.product_name,
        batchId: row.batch_id,
        batchNo: row.batch_no,
        expiry: row.expiry,
        locationId: row.location_id,
        locationName: row.location_name,
        locationType: row.location_type,
        status: row.status,
        qty: Number(row.qty),
      })),
    };
  });
}
