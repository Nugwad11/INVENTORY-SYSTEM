import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit.js';
import { authSecret, createGuards, hashPassword, signToken, verifyPassword } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import { ApiError } from '../errors.js';
import { createLoginLimiter } from '../login-rate-limit.js';
import type { Role } from '../types.js';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

interface LoginRow {
  id: string;
  store_id: string;
  name: string;
  role: Role;
  phone: string;
  active: boolean;
  password_hash: string | null;
  must_change_password: boolean;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  { config, db }: { config: AppConfig; db: Database },
): void {
  const guards = createGuards(db, config);
  const secret = authSecret(config);
  const limiter = createLoginLimiter({ maxAttempts: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_WINDOW_MS });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const limiterKey = `${request.ip}:${body.phone}`;
    const retryAfter = limiter.retryAfterSeconds(limiterKey);
    if (retryAfter > 0) {
      reply.header('retry-after', String(retryAfter));
      throw new ApiError(
        429,
        'TOO_MANY_ATTEMPTS',
        `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.`,
      );
    }

    const { rows } = await db.query<LoginRow>(
      `select id, store_id, name, role, phone, active, password_hash, must_change_password
       from users
       where phone = $1 and deleted_at is null`,
      [body.phone],
    );

    const user = rows[0];
    if (!user || !user.active || !user.password_hash) {
      limiter.recordFailure(limiterKey);
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid phone or password.');
    }

    const valid = await verifyPassword(user.password_hash, body.password);
    if (!valid) {
      limiter.recordFailure(limiterKey);
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid phone or password.');
    }

    limiter.reset(limiterKey);
    const token = await signToken(secret, user.id);
    return reply.send({
      token,
      mustChangePassword: user.must_change_password,
      user: {
        id: user.id,
        storeId: user.store_id,
        name: user.name,
        role: user.role,
        phone: user.phone,
      },
    });
  });

  app.get('/api/auth/me', { preHandler: [guards.authenticate] }, async (request) => {
    const { rows } = await db.query<Pick<LoginRow, 'id' | 'store_id' | 'name' | 'role' | 'phone' | 'must_change_password'>>(
      `select id, store_id, name, role, phone, must_change_password
       from users
       where id = $1 and active and deleted_at is null`,
      [request.user.id],
    );

    const user = rows[0];
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');

    return {
      mustChangePassword: user.must_change_password,
      user: {
        id: user.id,
        storeId: user.store_id,
        name: user.name,
        role: user.role,
        phone: user.phone,
      },
    };
  });

  app.post('/api/auth/change-password', { preHandler: [guards.authenticate] }, async (request) => {
    const actor = request.user;
    const body = changePasswordSchema.parse(request.body);

    if (body.currentPassword === body.newPassword) {
      throw new ApiError(422, 'PASSWORD_UNCHANGED', 'Choose a password different from the current one.');
    }

    const { rows } = await db.query<{ password_hash: string | null; must_change_password: boolean }>(
      `select password_hash, must_change_password
       from users
       where id = $1 and store_id = $2 and active and deleted_at is null`,
      [actor.id, actor.storeId],
    );
    const user = rows[0];
    if (!user?.password_hash) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    if (!(await verifyPassword(user.password_hash, body.currentPassword))) {
      throw new ApiError(422, 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect.');
    }

    const passwordHash = await hashPassword(body.newPassword);
    const changedAt = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx.query(
        `update users
         set password_hash = $1, password_updated_at = $2, must_change_password = false
         where id = $3 and store_id = $4`,
        [passwordHash, changedAt, actor.id, actor.storeId],
      );

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'PASSWORD_CHANGED',
        entityType: 'USER',
        entityId: actor.id,
        summary: `${actor.name} changed their password.`,
        before: { mustChangePassword: user.must_change_password },
        after: { mustChangePassword: false, passwordUpdatedAt: changedAt },
      });
    });

    return { changed: true, mustChangePassword: false };
  });
}
