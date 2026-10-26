import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { hashSync } from 'bcryptjs';
import type { Pool } from 'pg';
import { authDeps } from './helpers.js';

export const ADMIN = { email: 'admin@bancada.dev', password: 'senha-super-secreta', name: 'Admin' };
export const CSRF = { 'X-Requested-With': 'bancada-web', 'Content-Type': 'application/json' };

export async function insertAdminWithPassword(
  pool: Pool,
  overrides: Partial<typeof ADMIN> = {},
  cost = 4,
): Promise<string> {
  const admin = { ...ADMIN, ...overrides };
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO admins (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [admin.email, hashSync(admin.password, cost), admin.name],
  );
  return rows[0]!.id;
}

export function tokenFor(
  adminId: string,
  options: { secret?: string; algorithm?: 'HS256' | 'HS512'; expiresIn?: number } = {},
): string {
  return jwt.sign({ sub: adminId }, options.secret ?? authDeps.jwtSecret, {
    algorithm: options.algorithm ?? 'HS256',
    expiresIn: options.expiresIn ?? 3600,
  });
}

export function expiredTokenFor(adminId: string): string {
  const past = Math.floor(Date.now() / 1000) - 3600;
  return jwt.sign({ sub: adminId, iat: past - 60, exp: past }, authDeps.jwtSecret, {
    algorithm: 'HS256',
  });
}

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function algNoneToken(adminId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: adminId, exp })}.`;
}

// Token HS256 com a assinatura correta, mas payload adulterado depois de assinado.
export function tamperedToken(adminId: string, otherId: string): string {
  const [header, , signature] = tokenFor(adminId).split('.');
  return `${header}.${b64({ sub: otherId, exp: Math.floor(Date.now() / 1000) + 3600 })}.${signature}`;
}

export function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}
