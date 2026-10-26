import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Client } from 'pg';
import { runSeed } from '../src/db/seed.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

// Zera todos os dados (menos schema_migrations) e roda o seed. Chamar em beforeEach.
export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE payment_events, stock_movements, order_items, orders, admins, products
     RESTART IDENTITY CASCADE`,
  );
  await runSeed(pool, silentLogger);
}

export interface ScratchDb {
  url: string;
  drop: () => Promise<void>;
}

// Banco descartável (mesmo servidor do TEST_DATABASE_URL) para testar o runner de migrações do zero.
export async function createScratchDb(): Promise<ScratchDb> {
  const name = `bancada_test_scratch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const base = new URL(testDatabaseUrl());
  base.pathname = '/postgres';
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const cleaner = new Client({ connectionString: base.toString() });
      await cleaner.connect();
      await cleaner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await cleaner.end();
    },
  };
}

export async function insertProduct(
  pool: Pool,
  overrides: { slug?: string; stock?: number; priceCents?: number } = {},
): Promise<string> {
  const slug = overrides.slug ?? `produto-${randomUUID()}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO products (slug, name, description, category, price_cents, stock)
     VALUES ($1, 'Produto', 'Descrição', 'teste', $2, $3) RETURNING id`,
    [slug, overrides.priceCents ?? 1000, overrides.stock ?? 0],
  );
  return rows[0]!.id;
}

export async function insertOrder(pool: Pool, key: string = randomUUID()): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email,
                         total_cents, payment_provider)
     VALUES ($1, 'hash', 'Ana', 'ana@example.com', 1000, 'fake') RETURNING id`,
    [key],
  );
  return rows[0]!.id;
}

export async function insertAdmin(pool: Pool, email = 'admin@bancada.dev'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO admins (email, password_hash, name) VALUES ($1, 'hash', 'Admin') RETURNING id`,
    [email],
  );
  return rows[0]!.id;
}
