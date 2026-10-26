import { randomUUID } from 'node:crypto';
import {
  adminProductDetailSchema,
  adminProductSchema,
  stockAdjustmentResultSchema,
} from '@bancada/contracts';
import request from 'supertest';
import { createPool } from '../src/db/pool.js';
import { CSRF } from './auth-helpers.js';
import {
  IMAGE_KEY,
  IMAGE_KEY_2,
  buildAdminCtx,
  createOrderVia,
  expectLedgerConsistent,
  productIdBySlug,
  type AdminCtx,
} from './admin-helpers.js';
import { insertProduct, resetDb } from './db-helpers.js';
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

const newProduct = {
  name: 'Cabo USB-C Trançado',
  description: 'Cabo de 2 metros',
  category: 'Acessórios',
  priceCents: 8900,
  initialStock: 10,
};

async function productRow(id: string) {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0];
}

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query(sql);
  return rows[0].n;
}

describe('autenticação e CSRF em todas as rotas', () => {
  const id = randomUUID();
  const routes: [string, string][] = [
    ['get', '/admin/products'],
    ['get', `/admin/products/${id}`],
    ['post', '/admin/products'],
    ['patch', `/admin/products/${id}`],
    ['post', `/admin/products/${id}/stock`],
    ['get', '/admin/orders'],
    ['post', `/admin/orders/${id}/cancel`],
  ];

  it.each(routes)('%s %s sem cookie: 401 UNAUTHORIZED', async (method, path) => {
    const agent = request(ctx.app) as unknown as Record<string, (p: string) => request.Test>;
    const res = await agent[method]!(path).set(CSRF).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(routes.filter(([m]) => m !== 'get'))(
    '%s %s com cookie válido e SEM X-Requested-With: 403 CSRF_REJECTED',
    async (method, path) => {
      const agent = request(ctx.app) as unknown as Record<string, (p: string) => request.Test>;
      const res = await agent[method]!(path)
        .set('Cookie', ctx.cookie)
        .set('Content-Type', 'application/json')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_REJECTED');
    },
  );

  it('as respostas do admin não são cacheáveis', async () => {
    const res = await ctx.get('/admin/products');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /admin/products', () => {
  it('lista todos, inclusive inativos, por nome, com os campos de admin', async () => {
    await insertProduct(pool, {
      slug: 'inativo',
      name: 'abajur inativo',
      active: false,
      imageKey: IMAGE_KEY,
    });
    const res = await ctx.get('/admin/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(7);
    for (const item of res.body.data) {
      expect(adminProductSchema.strict().safeParse(item).success).toBe(true);
    }
    const names = res.body.data.map((p: { name: string }) => p.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
    const inactive = res.body.data.find((p: { slug: string }) => p.slug === 'inativo');
    expect(inactive).toMatchObject({
      active: false,
      imageKey: IMAGE_KEY,
      imageUrl: `https://cdn.test/${IMAGE_KEY}`,
    });
  });

  it('?active=true|false filtra', async () => {
    await insertProduct(pool, { slug: 'inativo', active: false });
    const inactive = await ctx.get('/admin/products?active=false');
    expect(inactive.body.data.map((p: { slug: string }) => p.slug)).toEqual(['inativo']);
    const active = await ctx.get('/admin/products?active=true');
    expect(active.body.data).toHaveLength(6);
  });

  it('?active inválido: 400 VALIDATION_ERROR', async () => {
    const res = await ctx.get('/admin/products?active=talvez');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('O filtro active deve ser');
  });

  it('?q= busca por nome sem diferenciar maiúsculas', async () => {
    const res = await ctx.get('/admin/products?q=TECLADO');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toContain('teclado');
  });

  it('% e _ em ?q= são literais, não curingas', async () => {
    await insertProduct(pool, { slug: 'p1', name: 'Desconto 50% off' });
    await insertProduct(pool, { slug: 'p2', name: 'Desconto 50 off' });
    await insertProduct(pool, { slug: 'p3', name: 'item_um' });
    await insertProduct(pool, { slug: 'p4', name: 'itemXum' });
    // O seed também tem um '%' literal ("Teclado Mecânico 75%"): só ele e o 'p1' casam com '%'.
    const percent = await ctx.get(`/admin/products?q=${encodeURIComponent('50%')}`);
    expect(percent.body.data.map((p: { slug: string }) => p.slug)).toEqual(['p1']);
    const underscore = await ctx.get(`/admin/products?q=${encodeURIComponent('item_um')}`);
    expect(underscore.body.data.map((p: { slug: string }) => p.slug)).toEqual(['p3']);
    const onlyWildcard = await ctx.get(`/admin/products?q=${encodeURIComponent('%')}`);
    expect(onlyWildcard.body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'p1',
      'teclado-mecanico-75',
    ]);
  });

  it('barra invertida em ?q= é literal e tentativa de injeção não vaza nem quebra', async () => {
    await insertProduct(pool, { slug: 'bs', name: 'caminho\\arquivo' });
    const literal = await ctx.get(`/admin/products?q=${encodeURIComponent('caminho\\arq')}`);
    expect(literal.body.data.map((p: { slug: string }) => p.slug)).toEqual(['bs']);
    const injection = await ctx.get(`/admin/products?q=${encodeURIComponent("' OR 1=1 --")}`);
    expect(injection.status).toBe(200);
    expect(injection.body.data).toEqual([]);
    expect(await count('SELECT count(*)::int AS n FROM products')).toBe(7);
  });

  it('?q repetido (array) e muito longo: 400', async () => {
    expect((await ctx.get('/admin/products?q=a&q=b')).status).toBe(400);
    expect((await ctx.get(`/admin/products?q=${'x'.repeat(101)}`)).status).toBe(400);
  });
});

describe('GET /admin/products/:id', () => {
  it('detalhe com as movimentações (seed: um initial)', async () => {
    const id = await productIdBySlug(pool, 'mouse');
    const res = await ctx.get(`/admin/products/${id}`);
    expect(res.status).toBe(200);
    expect(adminProductDetailSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data.movements).toHaveLength(1);
    expect(res.body.data.movements[0]).toMatchObject({ reason: 'initial', delta: 20 });
  });

  it('no máximo 20 movimentações, as mais recentes primeiro', async () => {
    const id = await productIdBySlug(pool, 'mouse');
    for (let i = 1; i <= 25; i++) {
      await ctx.post(`/admin/products/${id}/stock`, { delta: 1, reason: 'restock', note: `n${i}` });
    }
    const res = await ctx.get(`/admin/products/${id}`);
    expect(res.body.data.movements).toHaveLength(20);
    expect(res.body.data.movements[0].note).toBe('n25');
    expect(res.body.data.movements[19].note).toBe('n6');
    expect(res.body.data.stock).toBe(45);
  });

  it('inclui produto inativo', async () => {
    const id = await insertProduct(pool, { slug: 'off', active: false });
    expect((await ctx.get(`/admin/products/${id}`)).status).toBe(200);
  });

  it('inexistente e não-UUID: 404 NOT_FOUND', async () => {
    for (const id of [randomUUID(), 'abc', "1'; DROP TABLE products;--"]) {
      const res = await ctx.get(`/admin/products/${encodeURIComponent(id)}`);
      expect([id, res.status, res.body.error.code]).toEqual([id, 404, 'NOT_FOUND']);
    }
  });
});

describe('POST /admin/products', () => {
  it('201: slug sem acento em kebab-case, estoque 0 + movimento initial com admin_id e stock_after', async () => {
    const res = await ctx.post('/admin/products', newProduct);
    expect(res.status).toBe(201);
    expect(adminProductSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({
      slug: 'cabo-usb-c-trancado',
      name: 'Cabo USB-C Trançado',
      priceCents: 8900,
      stock: 10,
      active: true,
      imageKey: null,
      imageUrl: null,
    });
    const { rows } = await pool.query(
      'SELECT delta, reason, stock_after, admin_id, order_id FROM stock_movements WHERE product_id = $1',
      [res.body.data.id],
    );
    expect(rows).toEqual([
      { delta: 10, reason: 'initial', stock_after: 10, admin_id: ctx.adminId, order_id: null },
    ]);
    await expectLedgerConsistent(pool);
  });

  it('initialStock 0 não gera movimento', async () => {
    const res = await ctx.post('/admin/products', { ...newProduct, initialStock: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.stock).toBe(0);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1',
      [res.body.data.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it('com imageKey válido: grava a key e devolve imageUrl', async () => {
    const res = await ctx.post('/admin/products', { ...newProduct, imageKey: IMAGE_KEY });
    expect(res.body.data.imageKey).toBe(IMAGE_KEY);
    expect(res.body.data.imageUrl).toBe(`https://cdn.test/${IMAGE_KEY}`);
  });

  it.each([{ stock: 999 }, { slug: 'slug-forcado' }, { active: false }])(
    'campo fora do contrato %j: 400 (não é descartado em silêncio) e nada é criado',
    async (extra) => {
      const res = await ctx.post('/admin/products', { ...newProduct, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('Campo não permitido');
      expect(await count('SELECT count(*)::int AS n FROM products')).toBe(6);
    },
  );

  it('nome repetido: 409 SLUG_TAKEN e nada é criado', async () => {
    expect((await ctx.post('/admin/products', newProduct)).status).toBe(201);
    const products = await count('SELECT count(*)::int AS n FROM products');
    const movements = await count('SELECT count(*)::int AS n FROM stock_movements');
    const again = await ctx.post('/admin/products', newProduct);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SLUG_TAKEN');
    expect(await count('SELECT count(*)::int AS n FROM products')).toBe(products);
    expect(await count('SELECT count(*)::int AS n FROM stock_movements')).toBe(movements);
  });

  it('nomes que geram o mesmo slug também dão 409 (inclusive contra o seed)', async () => {
    const first = await ctx.post('/admin/products', { ...newProduct, name: 'Teclado Mecânico' });
    expect(first.status).toBe(201);
    const second = await ctx.post('/admin/products', { ...newProduct, name: 'teclado mecanico' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLUG_TAKEN');
    const seeded = await ctx.post('/admin/products', { ...newProduct, name: 'Hub USB-C 7 em 1' });
    expect(seeded.status).toBe(409);
  });

  it('criação concorrente do mesmo nome: exatamente um 201 e os demais 409', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ctx.post('/admin/products', newProduct)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(
      await count(`SELECT count(*)::int AS n FROM products WHERE slug = 'cabo-usb-c-trancado'`),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM stock_movements WHERE note IS NULL AND admin_id IS NOT NULL`,
      ),
    ).toBe(1);
    await expectLedgerConsistent(pool);
  });

  it('nome sem letras nem números (slug vazio): 400', async () => {
    const res = await ctx.post('/admin/products', { ...newProduct, name: '!!!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('letra ou número');
  });

  it.each([
    [{ name: '' }, 'Informe o nome do produto'],
    [{ priceCents: 0 }, 'O preço deve ser maior que zero'],
    [{ priceCents: 10.5 }, 'O preço deve ser um número inteiro de centavos'],
    [{ initialStock: -1 }, 'O estoque inicial não pode ser negativo'],
    [{ imageKey: 'products/a.png' }, 'Chave de imagem inválida'],
  ])('corpo inválido %j: 400 com mensagem em PT-BR', async (patch, message) => {
    const res = await ctx.post('/admin/products', { ...newProduct, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(message);
    expect(await count('SELECT count(*)::int AS n FROM products')).toBe(6);
  });
});

describe('PATCH /admin/products/:id', () => {
  async function created(extra: object = {}) {
    const res = await ctx.post('/admin/products', { ...newProduct, ...extra });
    return res.body.data as { id: string; slug: string; stock: number; updatedAt: string };
  }

  it('altera dados e preço, atualiza updated_at e NÃO mexe em estoque nem em slug', async () => {
    const product = await created();
    await new Promise((r) => setTimeout(r, 20));
    const res = await ctx.patch(`/admin/products/${product.id}`, {
      name: 'Cabo Novo Nome',
      description: 'Outra descrição',
      category: 'Cabos',
      priceCents: 9900,
    });
    expect(res.status).toBe(200);
    expect(adminProductSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Cabo Novo Nome',
      description: 'Outra descrição',
      category: 'Cabos',
      priceCents: 9900,
      stock: 10,
      slug: 'cabo-usb-c-trancado', // slug é IMUTÁVEL
    });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(product.updatedAt).getTime(),
    );
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1',
      [product.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it.each([
    { stock: 999 },
    { slug: 'outro-slug' },
    { initialStock: 5 },
    { id: randomUUID() },
    { createdAt: '2020-01-01T00:00:00.000Z' },
  ])('campo desconhecido %j: 400 e nada muda', async (extra) => {
    const product = await created();
    const before = await productRow(product.id);
    const res = await ctx.patch(`/admin/products/${product.id}`, { name: 'Tentativa', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('Campo não permitido');
    expect(await productRow(product.id)).toEqual(before);
  });

  it('corpo vazio: 400', async () => {
    const product = await created();
    const res = await ctx.patch(`/admin/products/${product.id}`, {});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('Informe ao menos um campo');
  });

  it('imageKey: ausente mantém, string troca, null remove (D16)', async () => {
    const product = await created({ imageKey: IMAGE_KEY });
    const keep = await ctx.patch(`/admin/products/${product.id}`, { name: 'Mantém imagem' });
    expect(keep.body.data.imageKey).toBe(IMAGE_KEY);

    const swap = await ctx.patch(`/admin/products/${product.id}`, { imageKey: IMAGE_KEY_2 });
    expect(swap.body.data.imageKey).toBe(IMAGE_KEY_2);
    expect(swap.body.data.imageUrl).toBe(`https://cdn.test/${IMAGE_KEY_2}`);

    const remove = await ctx.patch(`/admin/products/${product.id}`, { imageKey: null });
    expect(remove.body.data.imageKey).toBeNull();
    expect(remove.body.data.imageUrl).toBeNull();
    expect((await productRow(product.id)).image_key).toBeNull();
  });

  it('imageKey com formato inválido: 400', async () => {
    const product = await created();
    const res = await ctx.patch(`/admin/products/${product.id}`, { imageKey: '../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('Chave de imagem inválida');
  });

  it('inexistente e não-UUID: 404', async () => {
    for (const id of [randomUUID(), 'abc']) {
      const res = await ctx.patch(`/admin/products/${id}`, { name: 'x' });
      expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
    }
  });

  it('mudar o preço não altera order_items de pedidos existentes (snapshot)', async () => {
    const mouse = await productIdBySlug(pool, 'mouse');
    const order = await createOrderVia(ctx.app, [{ productId: mouse, quantity: 2 }]);
    await ctx.patch(`/admin/products/${mouse}`, { priceCents: 1, name: 'Mouse Renomeado' });
    const { rows } = await pool.query(
      'SELECT unit_price_cents, product_name FROM order_items WHERE order_id = $1',
      [order.id],
    );
    expect(rows[0]).toEqual({ unit_price_cents: 24900, product_name: 'Mouse Sem Fio Ergonômico' });
    const { rows: totals } = await pool.query('SELECT total_cents FROM orders WHERE id = $1', [
      order.id,
    ]);
    expect(totals[0].total_cents).toBe(49800);
    // Pedidos novos já usam o preço novo.
    const next = await createOrderVia(ctx.app, [{ productId: mouse, quantity: 1 }]);
    expect(next.totalCents).toBe(1);
  });

  it('produto inativo também pode ser editado', async () => {
    const id = await insertProduct(pool, { slug: 'off', active: false });
    const res = await ctx.patch(`/admin/products/${id}`, { name: 'Ainda off' });
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });
});

describe('desativar e reativar (D12)', () => {
  it('some do catálogo, dá 404 no detalhe e 422 em novo pedido; volta ao reativar', async () => {
    const mouse = await productIdBySlug(pool, 'mouse');
    expect((await request(ctx.app).get(`/products/${mouse}`)).status).toBe(200);

    const off = await ctx.patch(`/admin/products/${mouse}`, { active: false });
    expect(off.body.data.active).toBe(false);
    const list = await request(ctx.app).get('/products');
    expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(mouse);
    expect((await request(ctx.app).get(`/products/${mouse}`)).status).toBe(404);
    const blocked = await request(ctx.app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        customer: { name: 'Ana', email: 'ana@example.com' },
        items: [{ productId: mouse, quantity: 1 }],
      });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    // O admin continua vendo o produto inativo.
    const adminList = await ctx.get('/admin/products?active=false');
    expect(adminList.body.data.map((p: { id: string }) => p.id)).toEqual([mouse]);

    await ctx.patch(`/admin/products/${mouse}`, { active: true });
    expect((await request(ctx.app).get(`/products/${mouse}`)).status).toBe(200);
    const list2 = await request(ctx.app).get('/products');
    expect(list2.body.data.map((p: { id: string }) => p.id)).toContain(mouse);
  });

  it('pedido PENDING já existente continua válido e pode ser pago depois da desativação', async () => {
    const mouse = await productIdBySlug(pool, 'mouse');
    const order = await createOrderVia(ctx.app, [{ productId: mouse, quantity: 1 }]);
    await ctx.patch(`/admin/products/${mouse}`, { active: false });

    const get = await request(ctx.app).get(`/orders/${order.id}`);
    expect(get.body.data.status).toBe('PENDING');
    const paid = await request(ctx.app)
      .post('/dev/payments/simulate')
      .send({ orderId: order.id, status: 'approved' });
    expect(paid.body.data.outcome).toBe('applied');
    const after = await request(ctx.app).get(`/orders/${order.id}`);
    expect(after.body.data.status).toBe('PAID');
  });
});

describe('POST /admin/products/:id/stock', () => {
  const adjust = (id: string, body: object) => ctx.post(`/admin/products/${id}/stock`, body);

  it('200 {product, movement}: grava movimento com stock_after, reason, note e admin_id', async () => {
    const id = await productIdBySlug(pool, 'mouse');
    const res = await adjust(id, { delta: 5, reason: 'restock', note: 'Chegou lote novo' });
    expect(res.status).toBe(200);
    expect(stockAdjustmentResultSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data.product).toMatchObject({ id, stock: 25 });
    expect(res.body.data.movement).toMatchObject({
      productId: id,
      delta: 5,
      reason: 'restock',
      note: 'Chegou lote novo',
      adminId: ctx.adminId,
      orderId: null,
      stockAfter: 25,
    });
    await expectLedgerConsistent(pool);
  });

  it('observação em branco é gravada como NULL', async () => {
    const id = await productIdBySlug(pool, 'mouse');
    const res = await adjust(id, { delta: 1, reason: 'restock', note: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.data.movement.note).toBeNull();
  });

  it('ajuste negativo pode zerar o estoque', async () => {
    const id = await productIdBySlug(pool, 'suporte'); // estoque 3
    const res = await adjust(id, { delta: -3, reason: 'adjustment' });
    expect(res.status).toBe(200);
    expect(res.body.data.product.stock).toBe(0);
    expect(res.body.data.movement).toMatchObject({
      delta: -3,
      stockAfter: 0,
      reason: 'adjustment',
    });
  });

  it('ajuste que deixaria negativo: 409 INVALID_STOCK_ADJUSTMENT com details e NADA muda', async () => {
    const id = await productIdBySlug(pool, 'suporte');
    const movementsBefore = await count('SELECT count(*)::int AS n FROM stock_movements');
    const res = await adjust(id, { delta: -4, reason: 'adjustment' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STOCK_ADJUSTMENT');
    expect(res.body.error.details).toEqual({ available: 3, delta: -4 });
    expect((await productRow(id)).stock).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM stock_movements')).toBe(movementsBefore);
  });

  it('ajuste que passaria do teto do INTEGER: 409, não 500', async () => {
    const id = await productIdBySlug(pool, 'mouse');
    const res = await adjust(id, { delta: 2_147_483_647, reason: 'restock' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STOCK_ADJUSTMENT');
    expect((await productRow(id)).stock).toBe(20);
  });

  it.each([
    [{ delta: 0, reason: 'restock' }, 'A quantidade do ajuste não pode ser zero'],
    [{ delta: 1.5, reason: 'restock' }, 'A quantidade do ajuste deve ser um número inteiro'],
    [{ delta: 'a', reason: 'restock' }, 'Informe a quantidade do ajuste'],
    [{ delta: 1, reason: 'order' }, 'Informe o motivo do ajuste'],
    [{ delta: 1, reason: 'initial' }, 'Informe o motivo do ajuste'],
    [{ delta: 1 }, 'Informe o motivo do ajuste'],
    [{ delta: 1, reason: 'restock', note: 'x'.repeat(501) }, 'no máximo 500'],
  ])('corpo inválido %j: 400 em PT-BR e nada muda', async (body, message) => {
    const id = await productIdBySlug(pool, 'mouse');
    const res = await adjust(id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(message);
    expect((await productRow(id)).stock).toBe(20);
  });

  it('produto inexistente e não-UUID: 404', async () => {
    for (const id of [randomUUID(), 'abc']) {
      const res = await adjust(id, { delta: 1, reason: 'restock' });
      expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
    }
  });

  it('produto inativo também pode ter o estoque ajustado', async () => {
    const id = await insertProduct(pool, { slug: 'off', active: false, stock: 0 });
    const res = await adjust(id, { delta: 4, reason: 'restock' });
    expect(res.status).toBe(200);
    expect(res.body.data.product).toMatchObject({ stock: 4, active: false });
  });

  it('ajustes simultâneos no mesmo produto não se perdem (estoque == soma dos movimentos)', async () => {
    const id = await productIdBySlug(pool, 'caneca'); // 30
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        adjust(id, { delta: i % 2 === 0 ? 3 : -2, reason: 'adjustment' }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect((await productRow(id)).stock).toBe(30 + 5 * 3 - 5 * 2);
    await expectLedgerConsistent(pool);
  });

  it('ajustes do admin e pedidos simultâneos: sem deadlock, estoque nunca negativo e == soma dos movimentos', async () => {
    const id = await insertProduct(pool, {
      slug: 'disputado',
      name: 'Disputado',
      stock: 0,
      priceCents: 1000,
    });
    await pool.query(
      `INSERT INTO stock_movements (product_id, delta, reason, stock_after) VALUES ($1, 10, 'initial', 10)`,
      [id],
    );
    await pool.query('UPDATE products SET stock = 10 WHERE id = $1', [id]); // fixture alinhada ao livro-razão

    const orders = Array.from({ length: 10 }, () =>
      request(ctx.app)
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          customer: { name: 'Ana', email: 'ana@example.com' },
          items: [{ productId: id, quantity: 1 }],
        }),
    );
    const decreases = Array.from({ length: 10 }, () =>
      adjust(id, { delta: -1, reason: 'adjustment' }),
    );
    const increases = Array.from({ length: 5 }, () => adjust(id, { delta: 2, reason: 'restock' }));
    const results = await Promise.all([...orders, ...decreases, ...increases]);

    for (const r of results) expect([200, 201, 409]).toContain(r.status);
    for (const r of results.slice(20)) expect(r.status).toBe(200); // reposições nunca falham
    const stock = (await productRow(id)).stock;
    expect(stock).toBeGreaterThanOrEqual(0);
    await expectLedgerConsistent(pool);
    const okOrders = results.slice(0, 10).filter((r) => r.status === 201).length;
    const okDecreases = results.slice(10, 20).filter((r) => r.status === 200).length;
    expect(stock).toBe(10 - okOrders - okDecreases + 10);
  });
});
