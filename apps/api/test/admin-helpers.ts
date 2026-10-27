import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import type { StorageService } from '../src/modules/storage/storage.service.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { CSRF, insertAdminWithPassword, tokenFor } from './auth-helpers.js';
import { authDeps, silentLogger } from './helpers.js';

export const webUrl = 'http://localhost:5173';
export const IMAGE_KEY = 'products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.png';
export const IMAGE_KEY_2 = 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.webp';

export interface AdminCtx {
  app: Express;
  adminId: string;
  cookie: string;
  gateway: FakePaymentGateway;
  // Relógio do app (null = relógio real).
  clock: { now: Date | null };
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
}

export async function buildAdminCtx(
  pool: Pool,
  storage: StorageService = new FakeStorageService(),
): Promise<AdminCtx> {
  const adminId = await insertAdminWithPassword(pool);
  const cookie = `bancada_admin=${tokenFor(adminId)}`;
  const gateway = new FakePaymentGateway({ webUrl });
  const clock: { now: Date | null } = { now: null };
  const app = createApp({
    ...authDeps,
    pool,
    logger: silentLogger,
    webUrl,
    storage,
    gateway,
    now: () => clock.now ?? new Date(),
  });
  return {
    app,
    adminId,
    cookie,
    gateway,
    clock,
    get: (path) => request(app).get(path).set('Cookie', cookie),
    post: (path, body = {}) => request(app).post(path).set('Cookie', cookie).set(CSRF).send(body),
    patch: (path, body = {}) => request(app).patch(path).set('Cookie', cookie).set(CSRF).send(body),
  };
}

export async function productIdBySlug(pool: Pool, part: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM products WHERE slug LIKE $1', [
    `%${part}%`,
  ]);
  return rows[0]!.id;
}

// Cria um pedido pelo fluxo real (POST /orders): reserva estoque e grava o movimento 'order'.
export async function createOrderVia(
  app: Express,
  items: { productId: string; quantity: number }[],
  customer = { name: 'Ana Souza', email: 'ana@example.com' },
): Promise<{ id: string; totalCents: number }> {
  const res = await request(app)
    .post('/orders')
    .set('Idempotency-Key', randomUUID())
    .send({ customer, items });
  if (res.status !== 201) throw new Error(`falha ao criar pedido: ${res.status} ${res.text}`);
  return { id: res.body.data.id, totalCents: res.body.data.totalCents };
}

export async function ageOrder(pool: Pool, orderId: string, createdAt: Date): Promise<void> {
  await pool.query('UPDATE orders SET created_at = $2 WHERE id = $1', [orderId, createdAt]);
}

export async function expectLedgerConsistent(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
     GROUP BY p.id, p.stock HAVING p.stock <> COALESCE(SUM(m.delta), 0)`,
  );
  expect(rows).toEqual([]);
}
