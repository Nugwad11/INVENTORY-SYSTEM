import { randomInt } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import type { AuthUser, Role } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: Algorithm.Argon2id });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export function generateTemporaryPassword(length = 10): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
}

export function authSecret(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export function signToken(secret: Uint8Array, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);
}

interface UserRow {
  id: string;
  store_id: string;
  name: string;
  role: Role;
  active: boolean;
  deleted_at: string | null;
}

export function createGuards(db: Database, config: AppConfig) {
  const secret = authSecret(config);

  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'A bearer token is required.');
    }

    let userId: string;
    try {
      const { payload } = await jwtVerify(header.slice('Bearer '.length), secret);
      if (typeof payload.sub !== 'string') throw new Error('missing subject');
      userId = payload.sub;
    } catch {
      throw new ApiError(401, 'INVALID_TOKEN', 'The session token is invalid or expired.');
    }

    const { rows } = await db.query<UserRow>(
      'select id, store_id, name, role, active, deleted_at from users where id = $1',
      [userId],
    );
    const user = rows[0];
    if (!user || !user.active || user.deleted_at) {
      throw new ApiError(401, 'INACTIVE_USER', 'This account is not active.');
    }

    request.user = {
      id: user.id,
      storeId: user.store_id,
      name: user.name,
      role: user.role,
    };
  };

  const requireRoles = (...roles: Role[]) =>
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      await authenticate(request);
      if (!roles.includes(request.user.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Your role cannot perform this action.');
      }
    };

  return { authenticate, requireRoles };
}
