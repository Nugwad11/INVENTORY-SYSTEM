import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAudit } from '../audit.js';
import { createGuards, generateTemporaryPassword, hashPassword } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { Database, Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { ROLES, type Role } from '../types.js';

const USER_COLUMNS = `id, store_id, name, role, phone, active, must_change_password,
  password_updated_at, created_at`;

interface UserRow {
  id: string;
  store_id: string;
  name: string;
  role: Role;
  phone: string;
  active: boolean;
  must_change_password: boolean;
  password_updated_at: Date | string | null;
  created_at: Date | string;
}

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    active: row.active,
    mustChangePassword: row.must_change_password,
    passwordUpdatedAt: toIso(row.password_updated_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

async function findUser(tx: Queryable, storeId: string, userId: string): Promise<UserRow | null> {
  const { rows } = await tx.query<UserRow>(
    `select ${USER_COLUMNS} from users
     where id = $1 and store_id = $2 and deleted_at is null`,
    [userId, storeId],
  );
  return rows[0] ?? null;
}

async function countActiveOwners(tx: Queryable, storeId: string): Promise<number> {
  const { rows } = await tx.query<{ count: number }>(
    `select count(*)::int as count from users
     where store_id = $1 and role = 'owner' and active and deleted_at is null`,
    [storeId],
  );
  return rows[0]?.count ?? 0;
}

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  phone: z.string().trim().min(5).max(32),
  password: z.string().min(8).max(200).optional(),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(ROLES).optional(),
    phone: z.string().trim().min(5).max(32).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field is required.',
  });

const userIdSchema = z.uuid();

export function registerUserRoutes(
  app: FastifyInstance,
  { config, db }: { config: AppConfig; db: Database },
): void {
  const guards = createGuards(db, config);
  const admin = guards.requireRoles('owner', 'manager');

  app.get('/api/users', { preHandler: [admin] }, async (request) => {
    const { rows } = await db.query<UserRow>(
      `select ${USER_COLUMNS} from users
       where store_id = $1 and deleted_at is null
       order by created_at, name`,
      [request.user.storeId],
    );
    return { users: rows.map(toPublicUser) };
  });

  app.post('/api/users', { preHandler: [admin] }, async (request, reply) => {
    const actor = request.user;
    const body = createUserSchema.parse(request.body);

    if (body.role === 'owner' && actor.role !== 'owner') {
      throw new ApiError(403, 'FORBIDDEN', 'Only an owner can assign the owner role.');
    }

    const initialPassword = body.password ?? generateTemporaryPassword();
    const passwordHash = await hashPassword(initialPassword);
    const temporaryPassword = body.password ? undefined : initialPassword;

    const user = await db.transaction(async (tx) => {
      const { rows } = await tx.query<UserRow>(
        `insert into users
           (id, store_id, name, role, phone, password_hash, must_change_password)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${USER_COLUMNS}`,
        [
          randomUUID(),
          actor.storeId,
          body.name,
          body.role,
          body.phone,
          passwordHash,
          temporaryPassword !== undefined,
        ],
      );
      const created = rows[0];
      if (!created) throw new Error('Failed to create the user.');

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'USER_CREATED',
        entityType: 'USER',
        entityId: created.id,
        summary: `Added ${created.name} as ${created.role}.`,
        after: { name: created.name, role: created.role, phone: created.phone },
      });

      return created;
    });

    return reply.code(201).send({ user: toPublicUser(user), temporaryPassword });
  });

  app.patch('/api/users/:id', { preHandler: [admin] }, async (request) => {
    const actor = request.user;
    const userId = userIdSchema.parse((request.params as { id: string }).id);
    const body = updateUserSchema.parse(request.body);

    const user = await db.transaction(async (tx) => {
      const target = await findUser(tx, actor.storeId, userId);
      if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');

      if (target.id === actor.id && body.role && body.role !== target.role) {
        throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own role.');
      }
      if (body.role === 'owner' && target.role !== 'owner' && actor.role !== 'owner') {
        throw new ApiError(403, 'FORBIDDEN', 'Only an owner can assign the owner role.');
      }

      const demotingLastOwner =
        body.role !== undefined &&
        body.role !== 'owner' &&
        target.role === 'owner' &&
        target.active &&
        (await countActiveOwners(tx, actor.storeId)) <= 1;
      if (demotingLastOwner) {
        throw new ApiError(409, 'LAST_OWNER', 'The last active owner cannot lose the owner role.');
      }

      if (body.active === false) {
        if (target.id === actor.id) {
          throw new ApiError(422, 'SELF_DEACTIVATION', 'You cannot deactivate your own account.');
        }
        if (target.role === 'owner' && target.active && (await countActiveOwners(tx, actor.storeId)) <= 1) {
          throw new ApiError(409, 'LAST_OWNER', 'The last active owner cannot be deactivated.');
        }
      }

      const { rows } = await tx.query<UserRow>(
        `update users
         set name = coalesce($1, name),
             role = coalesce($2, role),
             phone = coalesce($3, phone),
             active = coalesce($4, active)
         where id = $5 and store_id = $6 and deleted_at is null
         returning ${USER_COLUMNS}`,
        [body.name ?? null, body.role ?? null, body.phone ?? null, body.active ?? null, userId, actor.storeId],
      );
      const updated = rows[0];
      if (!updated) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');

      const action =
        body.active === false ? 'USER_DEACTIVATED' : body.active === true && !target.active ? 'USER_REACTIVATED' : 'USER_UPDATED';
      const summary =
        action === 'USER_DEACTIVATED'
          ? `Deactivated ${updated.name}.`
          : action === 'USER_REACTIVATED'
            ? `Reactivated ${updated.name}.`
            : `Updated ${updated.name}'s details.`;

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action,
        entityType: 'USER',
        entityId: updated.id,
        summary,
        before: { name: target.name, role: target.role, phone: target.phone, active: target.active },
        after: { name: updated.name, role: updated.role, phone: updated.phone, active: updated.active },
      });

      return updated;
    });

    return { user: toPublicUser(user) };
  });

  app.post('/api/users/:id/password-reset', { preHandler: [admin] }, async (request) => {
    const actor = request.user;
    const userId = userIdSchema.parse((request.params as { id: string }).id);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await db.transaction(async (tx) => {
      const target = await findUser(tx, actor.storeId, userId);
      if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');

      const resetAt = new Date().toISOString();
      await tx.query(
        `update users
         set password_hash = $1, password_updated_at = $2, must_change_password = true
         where id = $3 and store_id = $4`,
        [passwordHash, resetAt, userId, actor.storeId],
      );

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'USER_PASSWORD_RESET',
        entityType: 'USER',
        entityId: userId,
        summary: `Reset the password for ${target.name}.`,
        before: { passwordUpdatedAt: toIso(target.password_updated_at) },
        after: { passwordUpdatedAt: resetAt },
      });
    });

    return { temporaryPassword };
  });

  app.delete('/api/users/:id', { preHandler: [admin] }, async (request, reply) => {
    const actor = request.user;
    const userId = userIdSchema.parse((request.params as { id: string }).id);

    await db.transaction(async (tx) => {
      const target = await findUser(tx, actor.storeId, userId);
      if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');

      if (target.id === actor.id) {
        throw new ApiError(422, 'SELF_DELETION', 'You cannot delete your own account.');
      }
      if (target.role === 'owner' && target.active && (await countActiveOwners(tx, actor.storeId)) <= 1) {
        throw new ApiError(409, 'LAST_OWNER', 'The last active owner cannot be deleted.');
      }

      await tx.query(
        `update users set active = false, deleted_at = now()
         where id = $1 and store_id = $2`,
        [userId, actor.storeId],
      );

      await appendAudit(tx, {
        storeId: actor.storeId,
        actor,
        action: 'USER_DELETED',
        entityType: 'USER',
        entityId: userId,
        summary: `Deleted ${target.name}.`,
        before: { name: target.name, role: target.role, phone: target.phone, active: target.active },
      });
    });

    return reply.code(204).send();
  });
}
