import { productSchema } from '@bancada/contracts';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { applyStockMovement } from '../src/modules/stock/stock.repository.js';
import { insertProduct, resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());
const app = createApp({
  pool,
  logger: silentLogger,
  webUrl: 'http://localhost:5173',
  storage: new FakeStorageService(),
});

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

async function onlyProducts(): Promise<void> {
  await pool.query('TRUNCATE stock_movements, products RESTART IDENTITY CASCADE');
}

describe('GET /products', () => {
  it('200 no envelope {data: [...]} com os produtos do seed', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toHaveLength(6);
  });

  it('cada item valida contra o productSchema do contracts', async () => {
    const res = await request(app).get('/products');
    for (const item of res.body.data) {
      expect(productSchema.strict().safeParse(item).success).toBe(true);
    }
  });

  it('não expõe campos de admin (active, imageKey, datas, preço do cliente)', async () => {
    const res = await request(app).get('/products');
    for (const item of res.body.data) {
      expect(Object.keys(item).sort()).toEqual(
        ['category', 'description', 'id', 'imageUrl', 'name', 'priceCents', 'slug', 'stock'].sort(),
      );
    }
  });

  it('traz só ativos, ordenados por nome', async () => {
    await onlyProducts();
    await insertProduct(pool, { slug: 'c', name: 'Cabo', stock: 1 });
    await insertProduct(pool, { slug: 'a', name: 'Adaptador', stock: 1 });
    await insertProduct(pool, { slug: 'x', name: 'Antigo', active: false });
    await insertProduct(pool, { slug: 'b', name: 'Base', stock: 1 });

    const res = await request(app).get('/products');
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual([
      'Adaptador',
      'Base',
      'Cabo',
    ]);
  });

  it('produto desativado some da listagem', async () => {
    const before = await request(app).get('/products');
    const target = before.body.data[0];
    await pool.query('UPDATE products SET active = false WHERE id = $1', [target.id]);
    const after = await request(app).get('/products');
    expect(after.body.data).toHaveLength(5);
    expect(after.body.data.map((p: { id: string }) => p.id)).not.toContain(target.id);
  });

  it('lista vazia é 200 com data []', async () => {
    await onlyProducts();
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('ordena ignorando maiúsculas/minúsculas e acentos de collation (lower(name))', async () => {
    await onlyProducts();
    await insertProduct(pool, { slug: 'z', name: 'zebra' });
    await insertProduct(pool, { slug: 'b', name: 'Bola' });
    await insertProduct(pool, { slug: 'a', name: 'abajur' });
    const res = await request(app).get('/products');
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(['abajur', 'Bola', 'zebra']);
  });

  it('inclui produto esgotado (stock 0) com stock 0', async () => {
    await onlyProducts();
    await insertProduct(pool, { slug: 'zero', name: 'Zero', stock: 0 });
    const res = await request(app).get('/products');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].stock).toBe(0);
  });

  it('monta imageUrl com a key e usa null sem imagem', async () => {
    await onlyProducts();
    await insertProduct(pool, { slug: 'com', name: 'Com', imageKey: 'products/abc.png' });
    await insertProduct(pool, { slug: 'sem', name: 'Sem' });
    const res = await request(app).get('/products');
    const byName = Object.fromEntries(
      res.body.data.map((p: { name: string; imageUrl: string | null }) => [p.name, p.imageUrl]),
    );
    expect(byName).toEqual({ Com: 'https://cdn.test/products/abc.png', Sem: null });
  });

  it('o estoque reflete os movimentos', async () => {
    await onlyProducts();
    const id = await insertProduct(pool, { slug: 'e', name: 'Estoque' });
    await applyStockMovement(pool, { productId: id, delta: 7, reason: 'restock' });
    const res = await request(app).get('/products');
    expect(res.body.data[0]).toMatchObject({ id, stock: 7 });
  });

  it('500 no envelope padrão quando o banco está inacessível', async () => {
    const broken = createPool('postgres://x:x@127.0.0.1:1/x');
    try {
      const res = await request(
        createApp({
          pool: broken,
          logger: silentLogger,
          webUrl: 'http://localhost:5173',
          storage: new FakeStorageService(),
        }),
      ).get('/products');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await broken.end();
    }
  });
});

describe('GET /products/:id', () => {
  it('200 {data: Product} válido no productSchema', async () => {
    const id = await insertProduct(pool, {
      slug: 'detalhe',
      name: 'Detalhe',
      priceCents: 12345,
      stock: 4,
      imageKey: 'products/d.webp',
    });
    const res = await request(app).get(`/products/${id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(productSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({
      id,
      slug: 'detalhe',
      name: 'Detalhe',
      priceCents: 12345,
      stock: 4,
      imageUrl: 'https://cdn.test/products/d.webp',
    });
  });

  it('imageUrl é null sem imagem', async () => {
    const id = await insertProduct(pool);
    const res = await request(app).get(`/products/${id}`);
    expect(res.body.data.imageUrl).toBeNull();
  });

  it('produto inativo: 404 NOT_FOUND', async () => {
    const id = await insertProduct(pool, { active: false });
    const res = await request(app).get(`/products/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('id inexistente: 404 NOT_FOUND', async () => {
    const res = await request(app).get('/products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    'abc',
    '123',
    'not-a-uuid',
    '3f2504e0-4f89-4d3a-9a0c-0305e82c33zz',
    "1'; DROP TABLE products;--",
  ])('id que não é UUID (%s): 404 NOT_FOUND, não 400 nem 500', async (id) => {
    const res = await request(app).get(`/products/${encodeURIComponent(id)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('o 404 segue o envelope padrão {error:{code,message}}', async () => {
    const res = await request(app).get('/products/abc');
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });
});
