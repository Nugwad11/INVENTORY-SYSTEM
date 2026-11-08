import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.js';

export function registerHealthRoutes(app: FastifyInstance, db: Database): void {
  app.get('/health', async () => {
    await db.query('select 1');
    return {
      status: 'ok',
      service: 'storehouse-api',
      time: new Date().toISOString(),
    };
  });
}
