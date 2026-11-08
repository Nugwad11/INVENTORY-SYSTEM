import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authSecret, createGuards, signToken, verifyPassword } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db.js';
import { ApiError } from '../errors.js';
import type { Role } from '../types.js';

const loginSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(200),
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

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { rows } = await db.query<LoginRow>(
      `select id, store_id, name, role, phone, active, password_hash, must_change_password
       from users
       where phone = $1 and deleted_at is null`,
      [body.phone],
    );

    const user = rows[0];
    if (!user || !user.active || !user.password_hash) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid phone or password.');
    }

    const valid = await verifyPassword(user.password_hash, body.password);
    if (!valid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid phone or password.');
    }

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
}
