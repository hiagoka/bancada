import { createPool } from '../src/db/pool.js';
import { runSeed, seedProducts } from '../src/db/seed.js';
import { resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('runSeed', () => {
  it('cria 6 produtos com slugs únicos e um deles com estoque 3', async () => {
    const { rows } = await pool.query(
      'SELECT slug, stock, price_cents FROM products ORDER BY slug',
    );
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(6);
    expect(rows.filter((r) => r.stock === 3)).toHaveLength(1);
    for (const r of rows) expect(Number.isInteger(r.price_cents) && r.price_cents > 0).toBe(true);
  });

  it('cobre os produtos esperados', async () => {
    const { rows } = await pool.query('SELECT name FROM products');
    const names = rows.map((r) => String(r.name).toLowerCase()).join(' | ');
    for (const word of ['teclado', 'mouse', 'headset', 'suporte', 'hub', 'caneca']) {
      expect(names).toContain(word);
    }
  });

  it('gera um movimento initial por produto e estoque == soma dos deltas', async () => {
    const { rows } = await pool.query(
      `SELECT p.id, p.stock,
              COALESCE(SUM(m.delta), 0)::int AS total,
              count(m.id)::int AS movements,
              count(m.id) FILTER (WHERE m.reason = 'initial')::int AS initials
       FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
       GROUP BY p.id`,
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.movements).toBe(1);
      expect(r.initials).toBe(1);
      expect(r.stock).toBe(r.total);
      expect(r.stock).toBeGreaterThan(0);
    }
  });

  it('stock_after do initial é o estoque do seed', async () => {
    const { rows } = await pool.query(
      `SELECT p.stock, m.stock_after FROM products p JOIN stock_movements m ON m.product_id = p.id`,
    );
    for (const r of rows) expect(r.stock_after).toBe(r.stock);
  });

  it('rodar de novo não duplica produtos nem movimentos', async () => {
    await runSeed(pool, silentLogger);
    await runSeed(pool, silentLogger);
    const products = await pool.query('SELECT count(*)::int AS n FROM products');
    const movements = await pool.query('SELECT count(*)::int AS n FROM stock_movements');
    expect(products.rows[0].n).toBe(6);
    expect(movements.rows[0].n).toBe(6);
  });

  it('rodar de novo não mexe no estoque atual nem refaz o initial', async () => {
    // Fixture: simula um estoque que mudou depois do seed (o repository é testado à parte).
    await pool.query(
      `UPDATE products SET stock = stock + 100 WHERE slug = (SELECT slug FROM products LIMIT 1)`,
    );
    const before = await pool.query('SELECT slug, stock FROM products ORDER BY slug');
    await runSeed(pool, silentLogger);
    const after = await pool.query('SELECT slug, stock FROM products ORDER BY slug');
    expect(after.rows).toEqual(before.rows);
  });

  it('atualiza dados do produto existente (upsert por slug) sem tocar no estoque', async () => {
    const [first] = seedProducts;
    await pool.query(`UPDATE products SET name = 'Outro', price_cents = 1 WHERE slug = $1`, [
      first!.slug,
    ]);
    await runSeed(pool, silentLogger);
    const { rows } = await pool.query('SELECT name, price_cents FROM products WHERE slug = $1', [
      first!.slug,
    ]);
    expect(rows[0]).toEqual({ name: first!.name, price_cents: first!.priceCents });
  });

  it('produto que existe sem movimentos recebe o initial', async () => {
    const [first] = seedProducts;
    await pool.query(
      `DELETE FROM stock_movements WHERE product_id = (SELECT id FROM products WHERE slug = $1)`,
      [first!.slug],
    );
    await pool.query(`UPDATE products SET stock = 0 WHERE slug = $1`, [first!.slug]);
    await runSeed(pool, silentLogger);
    const { rows } = await pool.query(
      `SELECT p.stock, count(m.id)::int AS n FROM products p
       LEFT JOIN stock_movements m ON m.product_id = p.id WHERE p.slug = $1 GROUP BY p.id`,
      [first!.slug],
    );
    expect(rows[0]).toEqual({ stock: first!.stock, n: 1 });
  });

  it('seeds simultâneos também não duplicam movimentos', async () => {
    await pool.query('TRUNCATE stock_movements, products RESTART IDENTITY CASCADE');
    await Promise.all([runSeed(pool, silentLogger), runSeed(pool, silentLogger)]);
    const movements = await pool.query('SELECT count(*)::int AS n FROM stock_movements');
    expect(movements.rows[0].n).toBe(6);
  });
});
