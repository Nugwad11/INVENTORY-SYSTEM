import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { seedDatabase, SEED_IDS } from '../src/seed.js';
import { createTestDatabase } from './helpers/pglite.js';

const migrationsDir = fileURLToPath(new URL('../../db/migrations', import.meta.url));

interface StockRow {
  productId: string;
  locationId: string;
  locationType: string;
  status: string;
  qty: number;
}

describe('Storehouse API', () => {
  let db: Database;
  let app: FastifyInstance;
  let config: AppConfig;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  const saleId = '11111111-1111-4111-8111-111111111111';

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function login(phone: string, password: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone, password },
    });
    return response;
  }

  async function fetchStock(token: string): Promise<StockRow[]> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stock',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { stock: StockRow[] }).stock;
  }

  async function sellableQty(token: string, productId: string): Promise<number> {
    const stock = await fetchStock(token);
    return stock
      .filter(
        (row) =>
          row.productId === productId && row.status === 'SELLABLE' && row.locationType === 'SELLING',
      )
      .reduce((sum, row) => sum + row.qty, 0);
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    await runMigrations(db, migrationsDir);
    await seedDatabase(db, 'Storehouse123!');

    config = {
      nodeEnv: 'test',
      port: 0,
      host: '127.0.0.1',
      databaseUrl: 'pglite://memory',
      jwtSecret: 'test-secret-that-is-long-enough-for-hs256',
      corsOrigins: ['http://localhost:5173'],
      seedPassword: 'Storehouse123!',
      migrationsDir,
    };

    app = await buildApp({ config, db });
    await app.ready();

    ownerToken = (await login('+2348030001001', config.seedPassword)).json().token;
    managerToken = (await login('+2348030001002', config.seedPassword)).json().token;
    cashierToken = (await login('+2348030001006', config.seedPassword)).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'storehouse-api' });
  });

  it('rejects bad credentials and protects routes', async () => {
    const bad = await login('+2348030001001', 'wrong-password');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');

    const anonymous = await app.inject({ method: 'GET', url: '/api/products' });
    expect(anonymous.statusCode).toBe(401);

    expect(ownerToken).toBeTruthy();
    expect(managerToken).toBeTruthy();
    expect(cashierToken).toBeTruthy();
  });

  it('seeds the opening stock and reports sellable quantities', async () => {
    expect(await sellableQty(ownerToken, SEED_IDS.milk)).toBe(12);
    expect(await sellableQty(ownerToken, SEED_IDS.rice)).toBe(10);
  });

  it('does not re-seed an existing store', async () => {
    const result = await seedDatabase(db, 'Storehouse123!');
    expect(result.skipped).toBe(true);
  });

  it('creates a sale with server pricing and FEFO allocation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sales',
      headers: auth(cashierToken),
      payload: {
        id: saleId,
        lines: [{ productId: SEED_IDS.milk, qty: 6 }],
        payment: 'CASH',
        deviceId: 'till-1',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { sale: { number: string; totalKobo: number; status: string; lines: unknown[] }; replayed: boolean };
    expect(body.replayed).toBe(false);
    expect(body.sale.number).toBe('S-0001');
    expect(body.sale.totalKobo).toBe(900_000);
    expect(body.sale.status).toBe('COMPLETED');
    expect(body.sale.lines).toHaveLength(1);

    expect(await sellableQty(ownerToken, SEED_IDS.milk)).toBe(6);

    const { rows } = await db.query<{ batch_id: string; qty: string }>(
      `select batch_id, qty::text from stock_movements
       where ref_id = $1 and type = 'SALE' order by seq`,
      [saleId],
    );
    expect(rows.map((row) => ({ batchId: row.batch_id, qty: Number(row.qty) }))).toEqual([
      { batchId: SEED_IDS.milkBatchA, qty: 5 },
      { batchId: SEED_IDS.milkBatchB, qty: 1 },
    ]);
  });

  it('replays a sale idempotently instead of double-decrementing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sales',
      headers: auth(cashierToken),
      payload: {
        id: saleId,
        lines: [{ productId: SEED_IDS.milk, qty: 6 }],
        payment: 'CASH',
        deviceId: 'till-1',
      },
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as { replayed: boolean }).replayed).toBe(true);
    expect(await sellableQty(ownerToken, SEED_IDS.milk)).toBe(6);

    const count = await db.query<{ count: number }>('select count(*)::int as count from sales where id = $1', [saleId]);
    expect(count.rows[0]?.count).toBe(1);
  });

  it('refuses to oversell', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sales',
      headers: auth(cashierToken),
      payload: {
        id: '22222222-2222-4222-8222-222222222222',
        lines: [{ productId: SEED_IDS.milk, qty: 100 }],
        payment: 'CASH',
        deviceId: 'till-1',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(await sellableQty(ownerToken, SEED_IDS.milk)).toBe(6);
  });

  it('lists and reads sales', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/sales', headers: auth(cashierToken) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { sales: { id: string }[] }).sales[0]?.id).toBe(saleId);

    const one = await app.inject({ method: 'GET', url: `/api/sales/${saleId}`, headers: auth(ownerToken) });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { sale: { number: string } }).sale.number).toBe('S-0001');
  });

  it('voids a sale and returns the stock to the selling location', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sales/${saleId}/void`,
      headers: auth(managerToken),
      payload: { reason: 'Customer cancelled the purchase', deviceId: 'till-1' },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { sale: { status: string } }).sale.status).toBe('VOIDED');
    expect(await sellableQty(ownerToken, SEED_IDS.milk)).toBe(12);

    const again = await app.inject({
      method: 'POST',
      url: `/api/sales/${saleId}/void`,
      headers: auth(managerToken),
      payload: { reason: 'Duplicate void attempt', deviceId: 'till-1' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SALE_NOT_VOIDABLE');
  });

  it('keeps the audit trail hash-chained', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/audit?limit=100', headers: auth(ownerToken) });
    expect(response.statusCode).toBe(200);

    const events = (response.json() as { events: { action: string; prevHash: string; hash: string }[] }).events;
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(['SALE_CREATED', 'SALE_VOIDED']).toContain(events[0]?.action);

    for (let index = 0; index < events.length - 1; index += 1) {
      expect(events[index]?.prevHash).toBe(events[index + 1]?.hash);
    }
    expect(events.at(-1)?.prevHash).toBe('0'.repeat(64));
  });

  it('creates users with temporary passwords and enforces role rules', async () => {
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'No Token', role: 'cashier', phone: '+2348030001999' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(managerToken),
      payload: { name: 'Ada Bello', role: 'cashier', phone: '+2348030001009' },
    });
    expect(created.statusCode).toBe(201);

    const body = created.json() as { user: { id: string; mustChangePassword: boolean }; temporaryPassword: string };
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.temporaryPassword).toHaveLength(10);

    const tempLogin = await login('+2348030001009', body.temporaryPassword);
    expect(tempLogin.statusCode).toBe(200);
    expect((tempLogin.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(managerToken),
      payload: { name: 'Duplicate', role: 'cashier', phone: '+2348030001009' },
    });
    expect(duplicate.statusCode).toBe(409);

    const escalate = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(managerToken),
      payload: { name: 'New Owner', role: 'owner', phone: '+2348030001010' },
    });
    expect(escalate.statusCode).toBe(403);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/users/${body.user.id}/password-reset`,
      headers: auth(ownerToken),
    });
    expect(reset.statusCode).toBe(200);
    const resetPassword = (reset.json() as { temporaryPassword: string }).temporaryPassword;
    expect(resetPassword).toHaveLength(10);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/users/${body.user.id}`,
      headers: auth(ownerToken),
    });
    expect(deleted.statusCode).toBe(204);

    expect((await login('+2348030001009', resetPassword)).statusCode).toBe(401);
  });

  it('changes a temporary password and clears the must-change flag', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(ownerToken),
      payload: { name: 'Ruth Eze', role: 'stock', phone: '+2348030001011' },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { user: { id: string }; temporaryPassword: string };

    const firstLogin = await login('+2348030001011', createdBody.temporaryPassword);
    expect(firstLogin.statusCode).toBe(200);
    const token = (firstLogin.json() as { token: string }).token;
    expect((firstLogin.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    const wrongCurrent = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: auth(token),
      payload: { currentPassword: 'not-the-temporary-password', newPassword: 'UpdatedPass123!' },
    });
    expect(wrongCurrent.statusCode).toBe(422);
    expect(wrongCurrent.json().error.code).toBe('INVALID_CURRENT_PASSWORD');

    const unchanged = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: auth(token),
      payload: { currentPassword: createdBody.temporaryPassword, newPassword: createdBody.temporaryPassword },
    });
    expect(unchanged.statusCode).toBe(422);
    expect(unchanged.json().error.code).toBe('PASSWORD_UNCHANGED');

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: auth(token),
      payload: { currentPassword: createdBody.temporaryPassword, newPassword: 'UpdatedPass123!' },
    });
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(false);

    expect((await login('+2348030001011', createdBody.temporaryPassword)).statusCode).toBe(401);
    const secondLogin = await login('+2348030001011', 'UpdatedPass123!');
    expect(secondLogin.statusCode).toBe(200);
    expect((secondLogin.json() as { mustChangePassword: boolean }).mustChangePassword).toBe(false);

    const audit = await app.inject({
      method: 'GET',
      url: `/api/audit?entityType=USER&entityId=${createdBody.user.id}`,
      headers: auth(ownerToken),
    });
    const passwordEvent = (audit.json() as { events: { action: string; before: unknown; after: unknown }[] }).events.find(
      (event) => event.action === 'PASSWORD_CHANGED',
    );
    expect(passwordEvent).toBeDefined();
    expect(JSON.stringify(passwordEvent)).not.toContain('UpdatedPass123!');
    expect(JSON.stringify(passwordEvent)).not.toContain(createdBody.temporaryPassword);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/users/${createdBody.user.id}`,
      headers: auth(ownerToken),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('locks an account and IP after repeated failed logins', async () => {
    const phone = '+2348030001077';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(phone, 'wrong-password');
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
    }

    const blocked = await login(phone, 'wrong-password');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const stillWrong = await login(phone, config.seedPassword);
    expect(stillWrong.statusCode).toBe(429);

    const otherAccount = await login('+2348030001002', config.seedPassword);
    expect(otherAccount.statusCode).toBe(200);
  });

  it('restricts product creation to permitted roles', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(cashierToken),
      payload: { sku: 'SNK-001', name: 'Chin Chin', costKobo: 30_000, priceKobo: 50_000 },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(managerToken),
      payload: { sku: 'SNK-001', name: 'Chin Chin', barcode: null, costKobo: 30_000, priceKobo: 50_000 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().product.barcode).toBeNull();

    const list = await app.inject({ method: 'GET', url: '/api/products?search=chin', headers: auth(cashierToken) });
    expect(list.statusCode).toBe(200);
    const products = (list.json() as { products: { sku: string; priceKobo: number }[] }).products;
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ sku: 'SNK-001', priceKobo: 50_000 });
  });

  it('updates product details and records the change', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(managerToken),
      payload: { sku: 'UPD-001', name: 'Before name', category: 'Test', costKobo: 6_000, priceKobo: 10_000 },
    });
    expect(created.statusCode).toBe(201);
    const product = (created.json() as { product: { id: string } }).product;

    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/products/${product.id}`,
      headers: auth(cashierToken),
      payload: { name: 'Cashier edit' },
    });
    expect(forbidden.statusCode).toBe(403);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/products/${product.id}`,
      headers: auth(managerToken),
      payload: { name: 'After name', category: 'Household', reorderPoint: 6, active: false },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { product: Record<string, unknown> }).product).toMatchObject({
      name: 'After name',
      category: 'Household',
      reorderPoint: 6,
      active: false,
      priceKobo: 10_000,
    });

    const audit = await app.inject({
      method: 'GET',
      url: `/api/audit?entityType=PRODUCT&entityId=${product.id}`,
      headers: auth(managerToken),
    });
    const events = (audit.json() as { events: { action: string }[] }).events;
    expect(events[0]?.action).toBe('PRODUCT_UPDATED');
  });

  it('changes prices only through the audited price endpoint', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(managerToken),
      payload: { sku: 'UPD-002', name: 'Price target', priceKobo: 10_000 },
    });
    const product = (created.json() as { product: { id: string } }).product;

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price`,
      headers: auth(cashierToken),
      payload: { priceKobo: 12_000, reason: 'Cashier price' },
    });
    expect(forbidden.statusCode).toBe(403);

    const changed = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price`,
      headers: auth(managerToken),
      payload: { priceKobo: 12_500, reason: 'Supplier promo' },
    });
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as { product: { priceKobo: number } }).product.priceKobo).toBe(12_500);

    const unchanged = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price`,
      headers: auth(managerToken),
      payload: { priceKobo: 12_500, reason: 'Same price' },
    });
    expect(unchanged.statusCode).toBe(422);
    expect(unchanged.json().error.code).toBe('PRICE_UNCHANGED');

    const badReason = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price`,
      headers: auth(managerToken),
      payload: { priceKobo: 13_000, reason: 'x' },
    });
    expect(badReason.statusCode).toBe(400);

    const audit = await app.inject({
      method: 'GET',
      url: `/api/audit?entityType=PRODUCT&entityId=${product.id}`,
      headers: auth(managerToken),
    });
    const events = (audit.json() as { events: { action: string; reason: string | null }[] }).events;
    expect(events[0]).toMatchObject({ action: 'PRICE_CHANGED', reason: 'Supplier promo' });
  });

  it('rejects renaming a product onto an existing SKU', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(managerToken),
      payload: { sku: 'UPD-003', name: 'First' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(managerToken),
      payload: { sku: 'UPD-004', name: 'Second' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const secondId = (second.json() as { product: { id: string } }).product.id;

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/products/${secondId}`,
      headers: auth(managerToken),
      payload: { sku: 'UPD-003' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('SKU_TAKEN');
  });

  it('rejects malformed request bodies with validation details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sales',
      headers: auth(cashierToken),
      payload: { id: 'not-a-uuid', lines: [], payment: 'CARD', deviceId: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.details.length).toBeGreaterThan(0);
  });

  it('scopes data to the authenticated store', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sales',
      headers: auth(managerToken),
    });
    expect(response.statusCode).toBe(200);
    const sales = (response.json() as { sales: { id: string }[] }).sales;
    expect(sales.every((sale) => sale.id === saleId)).toBe(true);
  });
});
