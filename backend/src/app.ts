import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProductRoutes } from './routes/products.js';
import { registerSaleRoutes } from './routes/sales.js';
import { registerUserRoutes } from './routes/users.js';

export interface AppDependencies {
  config: AppConfig;
  db: Database;
}

export async function buildApp({ config, db }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.nodeEnv === 'production' ? 'info' : 'debug' },
  });

  await app.register(cors, { origin: config.corsOrigins });
  app.decorateRequest('user', null as unknown as FastifyRequest['user']);

  app.addHook('onClose', async () => {
    await db.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request body or query is invalid.',
          details: error.issues,
        },
      });
    }

    if ((error as { code?: unknown }).code === '23505') {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'A record with that unique value already exists.' },
      });
    }

    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Bad request.' },
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  registerHealthRoutes(app, db);
  registerAuthRoutes(app, { config, db });
  registerUserRoutes(app, { config, db });
  registerProductRoutes(app, { config, db });
  registerSaleRoutes(app, { config, db });
  registerAuditRoutes(app, { config, db });

  return app;
}
