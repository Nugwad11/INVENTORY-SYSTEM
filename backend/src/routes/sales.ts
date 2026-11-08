import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createGuards } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import { ApiError } from '../errors.js';
import { createSale, getSale, listSales, voidSale } from '../services/sales.js';

const createSaleSchema = z.object({
  id: z.uuid(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        qty: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
  discountKobo: z.number().int().min(0).optional(),
  payment: z.enum(['CASH', 'TRANSFER', 'CREDIT']),
  customerName: z.string().trim().max(160).nullable().optional(),
  deviceId: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime().optional(),
});

const voidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  deviceId: z.string().trim().min(1).max(120),
});

const listSalesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const saleIdSchema = z.uuid();

export function registerSaleRoutes(
  app: FastifyInstance,
  { config, db }: { config: AppConfig; db: Database },
): void {
  const guards = createGuards(db, config);
  const cashier = guards.requireRoles('owner', 'manager', 'cashier');
  const reader = guards.requireRoles('owner', 'manager', 'stock', 'cashier', 'auditor');

  app.post('/api/sales', { preHandler: [cashier] }, async (request, reply) => {
    const body = createSaleSchema.parse(request.body);
    const result = await createSale(db, request.user, body);
    return reply.code(201).send(result);
  });

  app.get('/api/sales', { preHandler: [reader] }, async (request) => {
    const query = listSalesQuerySchema.parse(request.query);
    const sales = await listSales(db, request.user.storeId, query.limit);
    return { sales };
  });

  app.get('/api/sales/:id', { preHandler: [reader] }, async (request) => {
    const saleId = saleIdSchema.parse((request.params as { id: string }).id);
    const sale = await getSale(db, request.user.storeId, saleId);
    if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND', 'Sale not found.');
    return { sale };
  });

  app.post('/api/sales/:id/void', { preHandler: [cashier] }, async (request) => {
    const saleId = saleIdSchema.parse((request.params as { id: string }).id);
    const body = voidSaleSchema.parse(request.body);
    const sale = await voidSale(db, request.user, saleId, body.reason, body.deviceId);
    return { sale };
  });
}
