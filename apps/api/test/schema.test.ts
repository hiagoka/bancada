import type { Pool } from 'pg';
import { createPool } from '../src/db/pool.js';
import { insertAdmin, insertOrder, insertProduct, resetDb } from './db-helpers.js';
import { testDatabaseUrl } from './helpers.js';

const pool: Pool = createPool(testDatabaseUrl());

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

async function violation(promise: Promise<unknown>): Promise<PgErrorShape> {
  try {
    await promise;
  } catch (err) {
    return err as PgErrorShape;
  }
  throw new Error('A query deveria ter violado uma constraint');
}

const CHECK = '23514';
const UNIQUE = '23505';
const FK = '23503';

describe('constraints de products', () => {
  const insert = (priceCents: number, stock: number, slug = 'p-x'): Promise<unknown> =>
    pool.query(
      `INSERT INTO products (slug, name, description, category, price_cents, stock)
       VALUES ($1, 'n', 'd', 'c', $2, $3)`,
      [slug, priceCents, stock],
    );

  it.each([0, -100])('rejeita price_cents = %d', async (price) => {
    expect(await violation(insert(price, 1))).toMatchObject({
      code: CHECK,
      constraint: 'products_price_positive',
    });
  });

  it('rejeita stock negativo', async () => {
    expect(await violation(insert(100, -1))).toMatchObject({
      code: CHECK,
      constraint: 'products_stock_nonnegative',
    });
  });

  it('aceita stock 0', async () => {
    await expect(insert(100, 0)).resolves.toBeDefined();
  });

  it('rejeita UPDATE que deixaria o estoque negativo', async () => {
    const id = await insertProduct(pool, { stock: 1 });
    expect(
      await violation(pool.query('UPDATE products SET stock = stock - 2 WHERE id = $1', [id])),
    ).toMatchObject({ code: CHECK, constraint: 'products_stock_nonnegative' });
  });

  it('rejeita slug duplicado', async () => {
    await insertProduct(pool, { slug: 'duplicado' });
    expect(await violation(insertProduct(pool, { slug: 'duplicado' }))).toMatchObject({
      code: UNIQUE,
      constraint: 'products_slug_key',
    });
  });

  it('active começa true e image_key começa nula', async () => {
    const id = await insertProduct(pool);
    const { rows } = await pool.query('SELECT active, image_key FROM products WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ active: true, image_key: null });
  });
});

describe('constraints de admins', () => {
  it('rejeita e-mail duplicado', async () => {
    await insertAdmin(pool, 'a@b.com');
    expect(await violation(insertAdmin(pool, 'a@b.com'))).toMatchObject({
      code: UNIQUE,
      constraint: 'admins_email_key',
    });
  });

  it('rejeita e-mail com maiúsculas (salvo em minúsculo)', async () => {
    expect(await violation(insertAdmin(pool, 'Admin@B.com'))).toMatchObject({
      code: CHECK,
      constraint: 'admins_email_lowercase',
    });
  });
});

describe('constraints de orders e order_items', () => {
  it('rejeita idempotency_key duplicada', async () => {
    await insertOrder(pool, 'chave');
    expect(await violation(insertOrder(pool, 'chave'))).toMatchObject({
      code: UNIQUE,
      constraint: 'orders_idempotency_key_key',
    });
  });

  it('rejeita total_cents <= 0', async () => {
    expect(
      await violation(
        pool.query(
          `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email,
                               total_cents, payment_provider)
           VALUES ('k', 'h', 'n', 'e@e.com', 0, 'fake')`,
        ),
      ),
    ).toMatchObject({ code: CHECK, constraint: 'orders_total_positive' });
  });

  it('status começa PENDING e rejeita valor fora do enum', async () => {
    const id = await insertOrder(pool);
    const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [id]);
    expect(rows[0].status).toBe('PENDING');
    expect(
      await violation(pool.query(`UPDATE orders SET status = 'ENVIADO' WHERE id = $1`, [id])),
    ).toMatchObject({ code: '22P02' });
  });

  const insertItem = (orderId: string, productId: string, qty: number, price = 100) =>
    pool.query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
       VALUES ($1, $2, 'n', $3, $4)`,
      [orderId, productId, price, qty],
    );

  it.each([0, -1])('rejeita quantity = %d', async (qty) => {
    const orderId = await insertOrder(pool);
    const productId = await insertProduct(pool);
    expect(await violation(insertItem(orderId, productId, qty))).toMatchObject({
      code: CHECK,
      constraint: 'order_items_quantity_positive',
    });
  });

  it('rejeita unit_price_cents <= 0', async () => {
    const orderId = await insertOrder(pool);
    const productId = await insertProduct(pool);
    expect(await violation(insertItem(orderId, productId, 1, 0))).toMatchObject({
      code: CHECK,
      constraint: 'order_items_unit_price_positive',
    });
  });

  it('apagar o pedido apaga os itens (CASCADE)', async () => {
    const orderId = await insertOrder(pool);
    const productId = await insertProduct(pool);
    await insertItem(orderId, productId, 2);
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM order_items');
    expect(rows[0].n).toBe(0);
  });

  it('produto com itens de pedido não pode ser apagado (sem CASCADE)', async () => {
    const orderId = await insertOrder(pool);
    const productId = await insertProduct(pool);
    await insertItem(orderId, productId, 1);
    expect(
      await violation(pool.query('DELETE FROM products WHERE id = $1', [productId])),
    ).toMatchObject({ code: FK });
  });
});

describe('constraints de stock_movements', () => {
  const insertMovement = (productId: string, delta: number, reason: string, stockAfter = 5) =>
    pool.query(
      `INSERT INTO stock_movements (product_id, delta, reason, stock_after)
       VALUES ($1, $2, $3, $4)`,
      [productId, delta, reason, stockAfter],
    );

  it('rejeita delta = 0', async () => {
    const id = await insertProduct(pool);
    expect(await violation(insertMovement(id, 0, 'adjustment'))).toMatchObject({
      code: CHECK,
      constraint: 'stock_movements_delta_nonzero',
    });
  });

  it('rejeita reason fora da lista', async () => {
    const id = await insertProduct(pool);
    expect(await violation(insertMovement(id, 1, 'roubo'))).toMatchObject({
      code: CHECK,
      constraint: 'stock_movements_reason_valid',
    });
  });

  it.each(['initial', 'restock', 'adjustment', 'order', 'order_cancelled'])(
    'aceita reason %s',
    async (reason) => {
      const id = await insertProduct(pool);
      await expect(insertMovement(id, 1, reason)).resolves.toBeDefined();
    },
  );

  it('rejeita product_id inexistente', async () => {
    expect(
      await violation(insertMovement('00000000-0000-0000-0000-000000000000', 1, 'restock')),
    ).toMatchObject({ code: FK });
  });

  it('pedido com movimentos não pode ser apagado (sem CASCADE)', async () => {
    const productId = await insertProduct(pool);
    const orderId = await insertOrder(pool);
    await pool.query(
      `INSERT INTO stock_movements (product_id, delta, reason, order_id, stock_after)
       VALUES ($1, -1, 'order', $2, 0)`,
      [productId, orderId],
    );
    expect(
      await violation(pool.query('DELETE FROM orders WHERE id = $1', [orderId])),
    ).toMatchObject({ code: FK });
  });
});

describe('constraints de payment_events', () => {
  const insertEvent = (provider: string, paymentId: string, status: string) =>
    pool.query(
      `INSERT INTO payment_events (provider, payment_id, status, amount_cents)
       VALUES ($1, $2, $3, 1000)`,
      [provider, paymentId, status],
    );

  it('rejeita (provider, payment_id, status) duplicado', async () => {
    await insertEvent('fake', '123', 'approved');
    expect(await violation(insertEvent('fake', '123', 'approved'))).toMatchObject({
      code: UNIQUE,
      constraint: 'payment_events_dedupe_key',
    });
  });

  it('aceita o mesmo pagamento com outro status e ON CONFLICT DO NOTHING não insere', async () => {
    await insertEvent('fake', '123', 'pending');
    await expect(insertEvent('fake', '123', 'approved')).resolves.toBeDefined();
    const dup = await pool.query(
      `INSERT INTO payment_events (provider, payment_id, status, amount_cents)
       VALUES ('fake', '123', 'approved', 1000) ON CONFLICT DO NOTHING`,
    );
    expect(dup.rowCount).toBe(0);
  });
});

describe('índices', () => {
  it('existem os índices exigidos', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        'orders_status_idx',
        'orders_created_at_idx',
        'stock_movements_product_created_idx',
      ]),
    );
  });
});
