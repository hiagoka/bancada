import { publicOrderSchema } from '@bancada/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { insertProduct, resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl, authDeps } from './helpers.js';

const pool = createPool(testDatabaseUrl());
const gateway = new FakePaymentGateway({ webUrl: 'http://localhost:5173' });
const app = createApp({
  ...authDeps,
  pool,
  logger: silentLogger,
  webUrl: 'http://localhost:5173',
  storage: new FakeStorageService(),
  gateway,
});

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

const customer = { name: 'Ana Souza', email: 'ana@example.com' };

type Item = { productId: string; quantity: number } & Record<string, unknown>;

function post(items: Item[], key: string = randomUUID(), body: Record<string, unknown> = {}) {
  return request(app)
    .post('/orders')
    .set('Idempotency-Key', key)
    .send({ customer, items, ...body });
}

async function idOf(slugPart: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM products WHERE slug LIKE $1', [
    `%${slugPart}%`,
  ]);
  return rows[0]!.id;
}

async function count(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return rows[0].stock;
}

async function expectLedgerConsistent(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT p.id FROM products p
     LEFT JOIN stock_movements m ON m.product_id = p.id
     GROUP BY p.id, p.stock
     HAVING p.stock <> COALESCE(SUM(m.delta), 0)`,
  );
  expect(rows).toEqual([]);
}

async function expectNothingChanged(stocks: Record<string, number>): Promise<void> {
  expect(await count('orders')).toBe(0);
  expect(await count('order_items')).toBe(0);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order'`,
  );
  expect(rows[0].n).toBe(0);
  for (const [id, stock] of Object.entries(stocks)) expect(await stockOf(id)).toBe(stock);
}

describe('POST /orders: criação', () => {
  it('201 com publicOrderSchema, status PENDING, com checkout e sem dados do cliente', async () => {
    const teclado = await idOf('teclado');
    const res = await post([{ productId: teclado, quantity: 2 }]);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(publicOrderSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      totalCents: 2 * 59900,
      paidAt: null,
      items: [
        {
          productId: teclado,
          productName: 'Teclado Mecânico 75%',
          unitPriceCents: 59900,
          quantity: 2,
        },
      ],
    });
    expect(res.body.data.checkoutUrl).toBe(
      `http://localhost:5173/checkout-simulado/${res.body.data.id}`,
    );
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Ana Souza');
    expect(text).not.toContain('ana@example.com');
    expect(res.body.data).not.toHaveProperty('customer');
  });

  it('grava o pedido: cliente normalizado, provider, hash e checkout', async () => {
    const key = randomUUID();
    await post([{ productId: await idOf('mouse'), quantity: 1 }], key, {
      customer: { name: 'Ana Souza', email: 'ANA@Example.COM' },
    });
    const { rows } = await pool.query('SELECT * FROM orders');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotency_key: key,
      customer_name: 'Ana Souza',
      customer_email: 'ana@example.com',
      status: 'PENDING',
      payment_provider: 'fake',
      paid_at: null,
    });
    expect(rows[0].checkout_id).toBe(`fake-checkout-${rows[0].id}`);
    expect(rows[0].checkout_url).toBe(`http://localhost:5173/checkout-simulado/${rows[0].id}`);
    expect(rows[0].request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('total vem do preço do banco: preços enviados pelo cliente são ignorados', async () => {
    const mouse = await idOf('mouse');
    const res = await post(
      [{ productId: mouse, quantity: 2, priceCents: 1, unitPriceCents: 1, price: 0.01 }],
      randomUUID(),
      { totalCents: 1, total: 1 },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(2 * 24900);
    expect(res.body.data.items[0].unitPriceCents).toBe(24900);
    const { rows } = await pool.query('SELECT total_cents FROM orders');
    expect(rows[0].total_cents).toBe(2 * 24900);
  });

  it('soma itens repetidos do mesmo produto num único item', async () => {
    const mouse = await idOf('mouse');
    const res = await post([
      { productId: mouse, quantity: 1 },
      { productId: mouse, quantity: 2 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(3);
    expect(res.body.data.totalCents).toBe(3 * 24900);
    expect(await count('order_items')).toBe(1);
    expect(await stockOf(mouse)).toBe(17);
  });

  it('snapshot do item: mudar o preço depois não altera o pedido', async () => {
    const mouse = await idOf('mouse');
    const res = await post([{ productId: mouse, quantity: 1 }]);
    await pool.query('UPDATE products SET price_cents = 1, name = $2 WHERE id = $1', [
      mouse,
      'Outro',
    ]);
    const get = await request(app).get(`/orders/${res.body.data.id}`);
    expect(get.body.data.items[0]).toMatchObject({
      unitPriceCents: 24900,
      productName: 'Mouse Sem Fio Ergonômico',
    });
    expect(get.body.data.totalCents).toBe(24900);
  });

  it("reserva o estoque com movimentos 'order' (order_id, delta negativo, stock_after)", async () => {
    const hub = await idOf('hub');
    const teclado = await idOf('teclado');
    const res = await post([
      { productId: hub, quantity: 5 },
      { productId: teclado, quantity: 1 },
    ]);
    const orderId = res.body.data.id;
    expect(await stockOf(hub)).toBe(7);
    expect(await stockOf(teclado)).toBe(14);
    const { rows } = await pool.query(
      `SELECT product_id, delta, stock_after, reason, admin_id FROM stock_movements
       WHERE order_id = $1 ORDER BY product_id`,
      [orderId],
    );
    const byProduct = Object.fromEntries(rows.map((r) => [r.product_id, r]));
    expect(rows).toHaveLength(2);
    expect(byProduct[hub]).toMatchObject({
      delta: -5,
      stock_after: 7,
      reason: 'order',
      admin_id: null,
    });
    expect(byProduct[teclado]).toMatchObject({ delta: -1, stock_after: 14, reason: 'order' });
    await expectLedgerConsistent();
  });

  it('permite levar o estoque exatamente a zero', async () => {
    const suporte = await idOf('suporte');
    const res = await post([{ productId: suporte, quantity: 3 }]);
    expect(res.status).toBe(201);
    expect(await stockOf(suporte)).toBe(0);
  });

  it('aceita o total exatamente no limite do int4', async () => {
    const id = await insertProduct(pool, { slug: 'limite', priceCents: 2_147_483_647, stock: 1 });
    const res = await post([{ productId: id, quantity: 1 }]);
    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(2_147_483_647);
  });
});

describe('POST /orders: validação', () => {
  const item = async () => [{ productId: await idOf('mouse'), quantity: 1 }];

  it('Idempotency-Key ausente: 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/orders')
      .send({ customer, items: await item() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('Idempotency-Key');
    expect(await count('orders')).toBe(0);
  });

  it.each(['', '   '])('Idempotency-Key vazia (%p): 400', async (key) => {
    const res = await request(app)
      .post('/orders')
      .set('Idempotency-Key', key)
      .send({ customer, items: await item() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Idempotency-Key com 256 caracteres: 400; com 255: 201', async () => {
    const tooLong = await post(await item(), 'k'.repeat(256));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
    const ok = await post(await item(), 'k'.repeat(255));
    expect(ok.status).toBe(201);
  });

  it('corpo inválido: 400 VALIDATION_ERROR com mensagens em PT-BR', async () => {
    const res = await post([]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(
      'O pedido precisa ter ao menos um item',
    );
  });

  it('e-mail inválido e quantidade zero: 400', async () => {
    const mouse = await idOf('mouse');
    const res = await request(app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ customer: { name: 'A', email: 'x' }, items: [{ productId: mouse, quantity: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(2);
  });

  it('JSON malformado: 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"customer":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('total acima do int4: 400 VALIDATION_ERROR em PT-BR, nada muda', async () => {
    const id = await insertProduct(pool, { slug: 'caro', priceCents: 2_000_000_000, stock: 10 });
    const res = await post([{ productId: id, quantity: 2 }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).toContain('limite');
    expect(await count('orders')).toBe(0);
    expect(await stockOf(id)).toBe(10);
  });

  it('soma de vários itens que ultrapassa o int4 também dá 400', async () => {
    const a = await insertProduct(pool, { slug: 'caro-a', priceCents: 1_500_000_000, stock: 5 });
    const b = await insertProduct(pool, { slug: 'caro-b', priceCents: 1_500_000_000, stock: 5 });
    const res = await post([
      { productId: a, quantity: 1 },
      { productId: b, quantity: 1 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await count('orders')).toBe(0);
  });

  it('quantidade somada acima do máximo por item: 400', async () => {
    const mouse = await idOf('mouse');
    const res = await post([
      { productId: mouse, quantity: 600 },
      { productId: mouse, quantity: 600 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /orders: idempotência', () => {
  it('replay da mesma chave e corpo: 200, mesmo pedido, sem reservar estoque de novo', async () => {
    const mouse = await idOf('mouse');
    const key = randomUUID();
    const items = [{ productId: mouse, quantity: 2 }];
    const first = await post(items, key);
    const second = await post(items, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(await count('orders')).toBe(1);
    expect(await count('order_items')).toBe(1);
    expect(await stockOf(mouse)).toBe(18);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('o replay não depende do estoque atual nem de o produto continuar ativo', async () => {
    const suporte = await idOf('suporte');
    const key = randomUUID();
    const items = [{ productId: suporte, quantity: 3 }];
    const first = await post(items, key);
    await pool.query('UPDATE products SET active = false WHERE id = $1', [suporte]);
    const replay = await post(items, key);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
  });

  it('o corpo é canônico: ordem e repetição dos itens e caixa do e-mail não mudam o hash', async () => {
    const a = await idOf('mouse');
    const b = await idOf('hub');
    const key = randomUUID();
    const first = await post(
      [
        { productId: a, quantity: 1 },
        { productId: b, quantity: 2 },
        { productId: a, quantity: 2 },
      ],
      key,
    );
    const replay = await post(
      [
        { productId: b, quantity: 2 },
        { productId: a, quantity: 3 },
      ],
      key,
      { customer: { name: 'Ana Souza', email: 'ANA@example.com' } },
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
  });

  it('mesma chave com outros itens: 409 IDEMPOTENCY_KEY_REUSED e nada muda', async () => {
    const mouse = await idOf('mouse');
    const key = randomUUID();
    await post([{ productId: mouse, quantity: 1 }], key);
    const res = await post([{ productId: mouse, quantity: 2 }], key);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count('orders')).toBe(1);
    expect(await stockOf(mouse)).toBe(19);
  });

  it('mesma chave com outro cliente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const items = [{ productId: await idOf('mouse'), quantity: 1 }];
    const key = randomUUID();
    await post(items, key);
    const res = await post(items, key, {
      customer: { name: 'Outra Pessoa', email: 'outra@example.com' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('3 requisições simultâneas com a mesma chave: 1 pedido, 1 reserva, 1x 201 e 2x 200', async () => {
    const suporte = await idOf('suporte');
    const key = randomUUID();
    const items = [{ productId: suporte, quantity: 3 }];
    const results = await Promise.all([post(items, key), post(items, key), post(items, key)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await count('orders')).toBe(1);
    expect(await count('order_items')).toBe(1);
    expect(await stockOf(suporte)).toBe(0);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order'`,
    );
    expect(rows[0].n).toBe(1);
    await expectLedgerConsistent();
  });

  it('simultâneas com a mesma chave e estoque justo (3 de 3) dão replay, nunca OUT_OF_STOCK', async () => {
    for (let round = 0; round < 5; round++) {
      await resetDb(pool);
      const suporte = await idOf('suporte');
      const key = randomUUID();
      const items = [{ productId: suporte, quantity: 3 }];
      const results = await Promise.all(Array.from({ length: 5 }, () => post(items, key)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(await count('orders')).toBe(1);
    }
  });

  it('mesma chave simultânea com corpos diferentes: um vence, os outros recebem 409', async () => {
    const mouse = await idOf('mouse');
    const key = randomUUID();
    const results = await Promise.all(
      [1, 2, 3, 4].map((quantity) => post([{ productId: mouse, quantity }], key)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    expect(await count('orders')).toBe(1);
    await expectLedgerConsistent();
  });
});

describe('POST /orders: estoque e disponibilidade', () => {
  it('estoque insuficiente: 409 OUT_OF_STOCK com details e nada muda', async () => {
    const suporte = await idOf('suporte');
    const before = { [suporte]: 3 };
    const res = await post([{ productId: suporte, quantity: 4 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details).toEqual([{ productId: suporte, requested: 4, available: 3 }]);
    await expectNothingChanged(before);
  });

  it('lista todos os itens sem estoque e não reserva os que tinham', async () => {
    const suporte = await idOf('suporte');
    const caneca = await idOf('caneca');
    const mouse = await idOf('mouse');
    const res = await post([
      { productId: mouse, quantity: 1 },
      { productId: suporte, quantity: 9 },
      { productId: caneca, quantity: 31 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { productId: suporte, requested: 9, available: 3 },
        { productId: caneca, requested: 31, available: 30 },
      ]),
    );
    expect(res.body.error.details).toHaveLength(2);
    await expectNothingChanged({ [suporte]: 3, [caneca]: 30, [mouse]: 20 });
  });

  it('a falha por estoque não "queima" a chave: depois de repor, a mesma chave cria o pedido', async () => {
    const suporte = await idOf('suporte');
    const key = randomUUID();
    const items = [{ productId: suporte, quantity: 5 }];
    expect((await post(items, key)).status).toBe(409);
    await pool.query(`UPDATE products SET stock = stock + 10 WHERE id = $1`, [suporte]);
    await pool.query(
      `INSERT INTO stock_movements (product_id, delta, reason, stock_after) VALUES ($1, 10, 'restock', 13)`,
      [suporte],
    );
    const retry = await post(items, key);
    expect(retry.status).toBe(201);
    expect(await stockOf(suporte)).toBe(8);
  });

  it('produto inexistente: 422 PRODUCT_UNAVAILABLE e nada muda', async () => {
    const ghost = randomUUID();
    const mouse = await idOf('mouse');
    const res = await post([
      { productId: mouse, quantity: 1 },
      { productId: ghost, quantity: 1 },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(res.body.error.details).toEqual([{ productId: ghost }]);
    await expectNothingChanged({ [mouse]: 20 });
  });

  it('produto inativo: 422 PRODUCT_UNAVAILABLE e nada muda', async () => {
    const mouse = await idOf('mouse');
    await pool.query('UPDATE products SET active = false WHERE id = $1', [mouse]);
    const res = await post([{ productId: mouse, quantity: 1 }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    await expectNothingChanged({ [mouse]: 20 });
  });

  it('indisponível tem prioridade sobre estoque insuficiente (422 antes de 409)', async () => {
    const suporte = await idOf('suporte');
    const res = await post([
      { productId: suporte, quantity: 99 },
      { productId: randomUUID(), quantity: 1 },
    ]);
    expect(res.status).toBe(422);
  });

  it('6 pedidos simultâneos para 3 unidades: exatamente 3 dão certo, 3 OUT_OF_STOCK, estoque 0', async () => {
    const suporte = await idOf('suporte');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post([{ productId: suporte, quantity: 1 }])),
    );
    const ok = results.filter((r) => r.status === 201);
    const out = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(3);
    expect(out).toHaveLength(3);
    for (const r of out) expect(r.body.error.code).toBe('OUT_OF_STOCK');
    expect(await stockOf(suporte)).toBe(0);
    expect(await count('orders')).toBe(3);
    await expectLedgerConsistent();
  });

  it('pedidos com os produtos em ordem trocada, em paralelo, não dão deadlock', async () => {
    const a = await idOf('mouse');
    const b = await idOf('hub');
    const c = await idOf('caneca');
    const forward = [
      { productId: a, quantity: 1 },
      { productId: b, quantity: 1 },
      { productId: c, quantity: 1 },
    ];
    const backward = [...forward].reverse();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(i % 2 === 0 ? forward : backward)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await stockOf(a)).toBe(10);
    expect(await stockOf(b)).toBe(2);
    expect(await stockOf(c)).toBe(20);
    await expectLedgerConsistent();
  });

  it('invariante: estoque == soma dos movimentos após uma mistura de pedidos', async () => {
    const ids = [
      await idOf('mouse'),
      await idOf('hub'),
      await idOf('suporte'),
      await idOf('caneca'),
    ];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        post([
          { productId: ids[i % 4]!, quantity: 1 + (i % 3) },
          { productId: ids[(i + 1) % 4]!, quantity: 1 },
        ]),
      ),
    );
    await expectLedgerConsistent();
    const { rows } = await pool.query('SELECT min(stock)::int AS m FROM products');
    expect(rows[0].m).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /orders/:id', () => {
  async function createOne(): Promise<string> {
    const res = await post([{ productId: await idOf('mouse'), quantity: 1 }]);
    return res.body.data.id;
  }

  it('200 com publicOrderSchema e SEM dados do cliente', async () => {
    const id = await createOne();
    const res = await request(app).get(`/orders/${id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(publicOrderSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['checkoutUrl', 'createdAt', 'id', 'items', 'paidAt', 'pix', 'status', 'totalCents'].sort(),
    );
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Ana Souza');
    expect(text).not.toContain('ana@example.com');
    expect(text.toLowerCase()).not.toContain('customer');
    expect(text).not.toContain('request_hash');
    expect(text).not.toContain('idempotency');
  });

  it('checkoutUrl aparece só enquanto PENDING', async () => {
    const id = await createOne();
    await pool.query(
      `UPDATE orders SET checkout_id = 'c1', checkout_url = 'https://pay.test/c1' WHERE id = $1`,
      [id],
    );
    const pending = await request(app).get(`/orders/${id}`);
    expect(pending.body.data.checkoutUrl).toBe('https://pay.test/c1');

    for (const status of ['PAID', 'CANCELLED', 'REFUNDED']) {
      await pool.query('UPDATE orders SET status = $2 WHERE id = $1', [id, status]);
      const res = await request(app).get(`/orders/${id}`);
      expect(res.body.data.status).toBe(status);
      expect(res.body.data.checkoutUrl).toBeNull();
    }
  });

  it('paidAt preenchido quando pago', async () => {
    const id = await createOne();
    await pool.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [id]);
    const res = await request(app).get(`/orders/${id}`);
    expect(res.body.data.paidAt).toEqual(expect.any(String));
    expect(publicOrderSchema.safeParse(res.body.data).success).toBe(true);
  });

  it('404 NOT_FOUND para id inexistente', async () => {
    const res = await request(app).get(`/orders/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(['abc', '123', "1'; DROP TABLE orders;--"])('404 para id não-UUID (%s)', async (id) => {
    const res = await request(app).get(`/orders/${encodeURIComponent(id)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
