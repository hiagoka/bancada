import { randomUUID } from 'node:crypto';
import { adminOrdersPageSchema, orderSchema } from '@bancada/contracts';
import request from 'supertest';
import { createPool } from '../src/db/pool.js';
import {
  ageOrder,
  buildAdminCtx,
  createOrderVia,
  expectLedgerConsistent,
  productIdBySlug,
  type AdminCtx,
} from './admin-helpers.js';
import { resetDb } from './db-helpers.js';
import { testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());
let ctx: AdminCtx;

beforeEach(async () => {
  await resetDb(pool);
  ctx = await buildAdminCtx(pool);
});

afterAll(async () => {
  await pool.end();
});

const MIN = 60 * 1000;
const customer = { name: 'Ana Souza', email: 'ana@example.com' };

async function newOrder(items: [string, number][] = [['mouse', 2]]) {
  return createOrderVia(
    ctx.app,
    await Promise.all(
      items.map(async ([slug, quantity]) => ({
        productId: await productIdBySlug(pool, slug),
        quantity,
      })),
    ),
    customer,
  );
}

async function oldOrder(items: [string, number][] = [['mouse', 2]], ageMs = 31 * MIN) {
  const order = await newOrder(items);
  await ageOrder(pool, order.id, new Date(Date.now() - ageMs));
  return order;
}

async function stockOf(slug: string): Promise<number> {
  const { rows } = await pool.query('SELECT stock FROM products WHERE slug LIKE $1', [`%${slug}%`]);
  return rows[0].stock;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [id]);
  return rows[0].status;
}

async function cancelledMovements(orderId: string) {
  const { rows } = await pool.query(
    `SELECT product_id, delta, stock_after, admin_id, order_id FROM stock_movements
     WHERE reason = 'order_cancelled' AND order_id = $1 ORDER BY product_id`,
    [orderId],
  );
  return rows;
}

const cancel = (id: string) => ctx.post(`/admin/orders/${id}/cancel`);

describe('GET /admin/orders', () => {
  it('traz o pedido completo (customer, itens, checkout) e valida no orderSchema', async () => {
    const order = await newOrder();
    const res = await ctx.get('/admin/orders');
    expect(res.status).toBe(200);
    expect(adminOrdersPageSchema.strict().safeParse(res.body.data).success).toBe(true);
    const [item] = res.body.data.items;
    expect(orderSchema.safeParse(item).success).toBe(true);
    expect(item).toMatchObject({
      id: order.id,
      status: 'PENDING',
      customer,
      totalCents: 49800,
      cancellable: false,
      paidAt: null,
    });
    expect(item.checkoutUrl).toContain(`/checkout-simulado/${order.id}`);
    expect(item.items[0]).toMatchObject({ productName: 'Mouse Sem Fio Ergonômico', quantity: 2 });
  });

  it('o GET /orders/:id público continua SEM dados do cliente', async () => {
    const order = await newOrder();
    const res = await request(ctx.app).get(`/orders/${order.id}`);
    expect(JSON.stringify(res.body)).not.toContain('Ana Souza');
    expect(JSON.stringify(res.body)).not.toContain('ana@example.com');
    expect(res.body.data).not.toHaveProperty('cancellable');
  });

  it('paginação: 21 pedidos -> 2 páginas de 20 e 1, total correto, mais recentes primeiro', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const order = await newOrder([['caneca', 1]]);
      await ageOrder(pool, order.id, new Date(Date.now() - (21 - i) * 1000));
      ids.push(order.id);
    }
    const first = await ctx.get('/admin/orders');
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 20, total: 21 });
    expect(first.body.data.items).toHaveLength(20);
    expect(first.body.data.items.map((o: { id: string }) => o.id)).toEqual(
      [...ids].reverse().slice(0, 20),
    );

    const second = await ctx.get('/admin/orders?page=2');
    expect(second.body.data).toMatchObject({ page: 2, pageSize: 20, total: 21 });
    expect(second.body.data.items.map((o: { id: string }) => o.id)).toEqual([ids[0]]);

    const beyond = await ctx.get('/admin/orders?page=3');
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toMatchObject({ items: [], page: 3, total: 21 });
  });

  it('ordem decrescente por created_at, com desempate estável por id', async () => {
    const a = await newOrder();
    const b = await newOrder();
    const same = new Date(Date.now() - 5 * MIN);
    await ageOrder(pool, a.id, same);
    await ageOrder(pool, b.id, same);
    const res = await ctx.get('/admin/orders');
    const got = res.body.data.items.map((o: { id: string }) => o.id);
    expect(got).toEqual([a.id, b.id].sort().reverse());
  });

  it('?status= filtra e o total acompanha o filtro', async () => {
    const paid = await newOrder();
    await newOrder();
    await pool.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [paid.id]);
    const res = await ctx.get('/admin/orders?status=PAID');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items.map((o: { id: string }) => o.id)).toEqual([paid.id]);
    expect(res.body.data.items[0].paidAt).toEqual(expect.any(String));
    expect(res.body.data.items[0].checkoutUrl).toBeNull();
  });

  it.each([
    '?page=0',
    '?page=-1',
    '?page=abc',
    '?page=1.5',
    '?page=1&page=2',
    '?status=paid',
    '?status=XYZ',
  ])('parâmetro inválido %s: 400 VALIDATION_ERROR', async (qs) => {
    const res = await ctx.get(`/admin/orders${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cancellable na fronteira dos 30 minutos (relógio injetado) e só para PENDING', async () => {
    const order = await newOrder();
    const created = new Date('2026-03-10T12:00:00.000Z');
    await ageOrder(pool, order.id, created);
    const cancellableAt = async (now: Date): Promise<boolean> => {
      ctx.clock.now = now;
      const res = await ctx.get('/admin/orders');
      return res.body.data.items[0].cancellable;
    };
    expect(await cancellableAt(new Date(created.getTime() + 29 * MIN))).toBe(false);
    expect(await cancellableAt(new Date(created.getTime() + 30 * MIN))).toBe(false); // exatamente 30: ainda não
    expect(await cancellableAt(new Date(created.getTime() + 30 * MIN + 1))).toBe(true);

    for (const status of ['PAID', 'CANCELLED', 'REFUNDED']) {
      await pool.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, status]);
      expect([status, await cancellableAt(new Date(created.getTime() + 60 * MIN))]).toEqual([
        status,
        false,
      ]);
    }
  });

  it('sem cookie: 401; os dados do cliente não vazam', async () => {
    await newOrder();
    const res = await request(ctx.app).get('/admin/orders');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('ana@example.com');
  });
});

describe('POST /admin/orders/:id/cancel (8.8)', () => {
  it('antes de 30 minutos: 409 ORDER_NOT_CANCELLABLE e nada muda', async () => {
    const order = await newOrder();
    const stock = await stockOf('mouse');
    const res = await cancel(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect(await statusOf(order.id)).toBe('PENDING');
    expect(await stockOf('mouse')).toBe(stock);
    expect(await cancelledMovements(order.id)).toHaveLength(0);
  });

  it('exatamente 30 minutos ainda não cancela; um instante depois cancela', async () => {
    const order = await newOrder();
    const created = new Date('2026-03-10T12:00:00.000Z');
    await ageOrder(pool, order.id, created);
    ctx.clock.now = new Date(created.getTime() + 30 * MIN);
    expect((await cancel(order.id)).status).toBe(409);
    ctx.clock.now = new Date(created.getTime() + 30 * MIN + 1);
    expect((await cancel(order.id)).status).toBe(200);
    expect(await statusOf(order.id)).toBe('CANCELLED');
  });

  it('depois de 30 min: cancela, devolve o estoque e grava order_cancelled com order_id, admin_id e stock_after', async () => {
    const order = await oldOrder([
      ['mouse', 2],
      ['hub', 5],
    ]);
    expect(await stockOf('mouse')).toBe(18);
    expect(await stockOf('hub')).toBe(7);

    const res = await cancel(order.id);
    expect(res.status).toBe(200);
    expect(orderSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: order.id,
      status: 'CANCELLED',
      cancellable: false,
      customer,
    });

    expect(await stockOf('mouse')).toBe(20);
    expect(await stockOf('hub')).toBe(12);
    const movements = await cancelledMovements(order.id);
    expect(movements).toHaveLength(2);
    const byProduct = Object.fromEntries(movements.map((m) => [m.product_id, m]));
    expect(byProduct[await productIdBySlug(pool, 'mouse')]).toMatchObject({
      delta: 2,
      stock_after: 20,
      admin_id: ctx.adminId,
      order_id: order.id,
    });
    expect(byProduct[await productIdBySlug(pool, 'hub')]).toMatchObject({
      delta: 5,
      stock_after: 12,
      admin_id: ctx.adminId,
    });
    await expectLedgerConsistent(pool);
  });

  it('a lista do admin passa a mostrar CANCELLED e cancellable false', async () => {
    const order = await oldOrder();
    const before = await ctx.get('/admin/orders');
    expect(before.body.data.items[0]).toMatchObject({ id: order.id, cancellable: true });
    await cancel(order.id);
    const after = await ctx.get('/admin/orders');
    expect(after.body.data.items[0]).toMatchObject({ status: 'CANCELLED', cancellable: false });
  });

  it.each(['PAID', 'CANCELLED', 'REFUNDED'])(
    'pedido %s: 409 ORDER_NOT_CANCELLABLE e nada muda',
    async (status) => {
      const order = await oldOrder();
      await pool.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, status]);
      const stock = await stockOf('mouse');
      const res = await cancel(order.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
      expect(await statusOf(order.id)).toBe(status);
      expect(await stockOf('mouse')).toBe(stock);
      expect(await cancelledMovements(order.id)).toHaveLength(0);
    },
  );

  it('cancelar duas vezes (sequencial): a segunda dá 409 e o estoque volta uma só vez', async () => {
    const order = await oldOrder();
    expect((await cancel(order.id)).status).toBe(200);
    expect((await cancel(order.id)).status).toBe(409);
    expect(await stockOf('mouse')).toBe(20);
    expect(await cancelledMovements(order.id)).toHaveLength(1);
  });

  it('cancelamentos simultâneos do mesmo pedido: um 200, os demais 409, uma só devolução', async () => {
    const order = await oldOrder([['mouse', 4]]);
    const results = await Promise.all(Array.from({ length: 5 }, () => cancel(order.id)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await stockOf('mouse')).toBe(20);
    expect(await cancelledMovements(order.id)).toHaveLength(1);
    await expectLedgerConsistent(pool);
  });

  it('pedido inexistente e id não-UUID: 404 NOT_FOUND', async () => {
    for (const id of [randomUUID(), 'abc', "1'; DROP TABLE orders;--"]) {
      const res = await cancel(encodeURIComponent(id));
      expect([id, res.status, res.body.error.code]).toEqual([id, 404, 'NOT_FOUND']);
    }
  });

  it('cancelamento concorrente com criação de pedidos do mesmo produto: sem deadlock', async () => {
    const orders = [await oldOrder([['mouse', 3]]), await oldOrder([['mouse', 2]])];
    const mouse = await productIdBySlug(pool, 'mouse');
    const creations = Array.from({ length: 6 }, () =>
      request(ctx.app)
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ customer, items: [{ productId: mouse, quantity: 1 }] }),
    );
    const results = await Promise.all([...orders.map((o) => cancel(o.id)), ...creations]);
    expect(results.slice(0, 2).map((r) => r.status)).toEqual([200, 200]);
    expect(results.slice(2).map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(await stockOf('mouse')).toBe(20 - 5 + 5 - 6);
    await expectLedgerConsistent(pool);
  });

  it('cancelamento concorrente com webhook do mesmo pedido: um vence, estoque devolvido uma vez', async () => {
    const order = await oldOrder([['mouse', 3]]);
    const [manual, hook] = await Promise.all([
      cancel(order.id),
      request(ctx.app)
        .post('/dev/payments/simulate')
        .send({ orderId: order.id, status: 'cancelled' }),
    ]);
    expect(hook.status).toBe(200);
    expect(
      [manual.status === 200, hook.body.data.outcome === 'applied'].filter(Boolean),
    ).toHaveLength(1);
    expect(await stockOf('mouse')).toBe(20);
    expect(await statusOf(order.id)).toBe('CANCELLED');
    await expectLedgerConsistent(pool);
  });

  it('pagamento aprovado depois do cancelamento manual não reativa o pedido', async () => {
    const order = await oldOrder();
    await cancel(order.id);
    const paid = await request(ctx.app)
      .post('/dev/payments/simulate')
      .send({ orderId: order.id, status: 'approved' });
    expect(paid.body.data.outcome).toBe('invalid_transition');
    expect(await statusOf(order.id)).toBe('CANCELLED');
    expect(await stockOf('mouse')).toBe(20);
    const res = await request(ctx.app).get(`/orders/${order.id}`);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('sem cookie: 401; com cookie e sem X-Requested-With: 403 e nada muda', async () => {
    const order = await oldOrder();
    const anon = await request(ctx.app)
      .post(`/admin/orders/${order.id}/cancel`)
      .set('X-Requested-With', 'bancada-web')
      .set('Content-Type', 'application/json')
      .send({});
    expect(anon.status).toBe(401);
    const noHeader = await request(ctx.app)
      .post(`/admin/orders/${order.id}/cancel`)
      .set('Cookie', ctx.cookie)
      .set('Content-Type', 'application/json')
      .send({});
    expect(noHeader.status).toBe(403);
    expect(await statusOf(order.id)).toBe('PENDING');
  });
});
