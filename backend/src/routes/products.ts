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
  barcode: z.string().trim().max(64).nullable().optional(),
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

const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    sku: z.string().trim().min(1).max(64).optional(),
    brand: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    barcode: z.string().trim().max(64).nullable().optional(),
    baseUnit: z.enum(['each', 'kg', 'litre', 'metre']).optional(),
    packSize: z.number().positive().optional(),
    packLabel: z.string().trim().max(64).optional(),
    costKobo: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    batchTracked: z.boolean().optional(),
    perishable: z.boolean().optional(),
    expiryWarningDays: z.number().int().min(0).optional(),
    reorderPoint: z.number().min(0).optional(),
    safetyStock: z.number().min(0).optional(),
    reorderMultiple: z.number().positive().optional(),
    supplierId: z.uuid().nullable().optional(),
    defaultLocationId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field is required.',
  });

const priceChangeSchema = z.object({
  priceKobo: z.number().int().min(0),
  reason: z.string().trim().min(3).max(200),
});

const productIdSchema = z.object({ id: z.uuid() });

const PRODUCT_UPDATABLE: Array<[keyof z.infer<typeof updateProductSchema>, string]> = [
  ['name', 'name'],
  ['sku', 'sku'],
  ['brand', 'brand'],
  ['category', 'category'],
  ['barcode', 'barcode'],
  ['baseUnit', 'base_unit'],
  ['packSize', 'pack_size'],
  ['packLabel', 'pack_label'],
  ['costKobo', 'cost_kobo'],
  ['active', 'active'],
  ['batchTracked', 'batch_tracked'],
  ['perishable', 'perishable'],
  ['expiryWarningDays', 'expiry_warning_days'],
  ['reorderPoint', 'reorder_point'],
  ['safetyStock', 'safety_stock'],
  ['reorderMultiple', 'reorder_multiple'],
  ['supplierId', 'supplier_id'],
  ['defaultLocationId', 'default_location_id'],
];

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

  app.patch('/api/products/:id', { preHandler: [writer] }, async (request) => {
    const actor = request.user;
    const { id } = productIdSchema.parse(request.params);
    const body = updateProductSchema.parse(request.body);

    const updated = await db.transaction(async (tx) => {
      const { rows } = await tx.query<ProductRow>(
        `select ${productColumns} from products p where p.id = $1 and p.store_id = $2 for update`,
        [id, actor.storeId],
      );
      const existing = rows[0];
      if (!existing) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found in this store.');

      if (body.sku && body.sku.toLowerCase() !== existing.sku.toLowerCase()) {
        const duplicate = await tx.query(
          'select 1 from products where store_id = $1 and lower(sku) = lower($2) and id <> $3',
          [actor.storeId, body.sku, id],
        );
        if (duplicate.rows.length > 0) {
          throw new ApiError(409, 'SKU_TAKEN', `SKU ${body.sku} is already used by another product.`);
        }
      }
      if (body.supplierId) {
        const supplier = await tx.query('select 1 from suppliers where id = $1 and store_id = $2', [
          body.supplierId,
          actor.storeId,
        ]);
        if (supplier.rows.length === 0) {
          throw new ApiError(422, 'SUPPLIER_NOT_FOUND', 'Supplier not found in this store.');
        }
      }
      if (body.defaultLocationId) {
        const location = await tx.query('select 1 from locations where id = $1 and store_id = $2', [
          body.defaultLocationId,
          actor.storeId,
        ]);
        if (location.rows.length === 0) {
          throw new ApiError(422, 'LOCATION_NOT_FOUND', 'Location not found in this store.');
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let index = 1;
      for (const [field, column] of PRODUCT_UPDATABLE) {
        const value = body[field];
        if (value !== undefined) {
          sets.push(`${column} = $${index++}`);
          params.push(value);
        }
      }
      params.push(id);
      const idIndex = index++;
      params.push(actor.storeId);
      const storeIndex = index;

      const result = await tx.query<ProductRow>(
        `update products as p set ${sets.join(', ')}
         where p.id = $${idIndex} and p.store_id = $${storeIndex}
         returning ${productColumns}`,
        params,
      );
      const row = result.rows[0];
      if (!row) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found in this store.');

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'PRODUCT_UPDATED',
        entityType: 'PRODUCT',
        entityId: id,
        summary: `Updated product ${row.sku} (${Object.keys(body).join(', ')}).`,
        before: toProduct(existing),
        after: toProduct(row),
      });

      return row;
    });

    return { product: toProduct(updated) };
  });

  app.post('/api/products/:id/price', { preHandler: [writer] }, async (request) => {
    const actor = request.user;
    const { id } = productIdSchema.parse(request.params);
    const body = priceChangeSchema.parse(request.body);

    const updated = await db.transaction(async (tx) => {
      const { rows } = await tx.query<ProductRow>(
        `select ${productColumns} from products p where p.id = $1 and p.store_id = $2 for update`,
        [id, actor.storeId],
      );
      const existing = rows[0];
      if (!existing) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found in this store.');
      if (Number(existing.price_kobo) === body.priceKobo) {
        throw new ApiError(422, 'PRICE_UNCHANGED', 'The new price matches the current price.');
      }

      const result = await tx.query<ProductRow>(
        `update products as p set price_kobo = $1
         where p.id = $2 and p.store_id = $3
         returning ${productColumns}`,
        [body.priceKobo, id, actor.storeId],
      );
      const row = result.rows[0];
      if (!row) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found in this store.');

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'PRICE_CHANGED',
        entityType: 'PRODUCT',
        entityId: id,
        summary: `Changed the selling price for ${row.sku}.`,
        before: { priceKobo: Number(existing.price_kobo) },
        after: { priceKobo: body.priceKobo },
        reason: body.reason,
      });

      return row;
    });

    return { product: toProduct(updated) };
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
