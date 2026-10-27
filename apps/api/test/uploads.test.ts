import { uploadResponseSchema } from '@bancada/contracts';
import request from 'supertest';
import { createPool } from '../src/db/pool.js';
import { CSRF } from './auth-helpers.js';
import { buildAdminCtx, type AdminCtx } from './admin-helpers.js';
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

const upload = (body?: unknown) => ctx.post('/admin/uploads/product-image', body as object);

describe('POST /admin/uploads/product-image (storage fake)', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('%s: 200 {data: uploadResponse} com key products/<uuid>.%s', async (contentType, ext) => {
    const res = await upload({ contentType });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(uploadResponseSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(res.body.data.key).toMatch(new RegExp(`^products/[0-9a-f-]{36}\\.${ext}$`));
    expect(typeof res.body.data.uploadUrl).toBe('string');
    expect(res.body.data.fields.key).toBe(res.body.data.key);
  });

  it('a chave muda a cada chamada', async () => {
    const a = await upload({ contentType: 'image/png' });
    const b = await upload({ contentType: 'image/png' });
    expect(a.body.data.key).not.toBe(b.body.data.key);
  });

  it.each([
    ['application/pdf', { contentType: 'application/pdf' }],
    ['image/gif', { contentType: 'image/gif' }],
    ['image/svg+xml', { contentType: 'image/svg+xml' }],
    ['vazio', { contentType: '' }],
    ['ausente', {}],
    ['não-string', { contentType: 123 }],
    ['maiúsculas', { contentType: 'IMAGE/PNG' }],
  ])(
    'tipo inválido (%s): 400 INVALID_FILE_TYPE em PT-BR, não VALIDATION_ERROR',
    async (_name, body) => {
      const res = await upload(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
      expect(res.body.error.message).toBe('Tipo de arquivo não permitido. Use JPEG, PNG ou WebP');
    },
  );

  it('corpo que não é um objeto (array): 400 INVALID_FILE_TYPE', async () => {
    const res = await request(ctx.app)
      .post('/admin/uploads/product-image')
      .set('Cookie', ctx.cookie)
      .set(CSRF)
      .send('["image/png"]');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('sem cookie: 401', async () => {
    const res = await request(ctx.app)
      .post('/admin/uploads/product-image')
      .set(CSRF)
      .send({ contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('com cookie e sem X-Requested-With: 403 CSRF_REJECTED', async () => {
    const res = await request(ctx.app)
      .post('/admin/uploads/product-image')
      .set('Cookie', ctx.cookie)
      .set('Content-Type', 'application/json')
      .send({ contentType: 'image/png' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('a chave devolvida é aceita ao criar um produto', async () => {
    const up = await upload({ contentType: 'image/webp' });
    const created = await ctx.post('/admin/products', {
      name: 'Com imagem',
      description: 'd',
      category: 'c',
      priceCents: 100,
      initialStock: 1,
      imageKey: up.body.data.key,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.imageUrl).toBe(`https://cdn.test/${up.body.data.key}`);
  });
});
