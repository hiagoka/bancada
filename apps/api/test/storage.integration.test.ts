import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_UPLOAD_BYTES, type UploadResponse } from '@bancada/contracts';
import request from 'supertest';
import { createPool } from '../src/db/pool.js';
import { S3StorageService } from '../src/modules/storage/s3.storage.js';
import { buildAdminCtx } from './admin-helpers.js';
import { resetDb } from './db-helpers.js';
import { testDatabaseUrl } from './helpers.js';

// Testes de integração REAIS contra o MinIO local (nada de mock do S3).
// Sem MinIO: pulam com aviso. Com REQUIRE_MINIO=true: FALHAM (o CI define essa variável).
const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000';
const accessKeyId = process.env.S3_TEST_ACCESS_KEY ?? 'minioadmin';
const secretAccessKey = process.env.S3_TEST_SECRET_KEY ?? 'minioadmin';
const bucket = process.env.S3_TEST_BUCKET ?? 'bancada';
const publicBase = `${endpoint}/${bucket}`;
const available = process.env.MINIO_AVAILABLE === 'true';

if (!available && process.env.REQUIRE_MINIO === 'true') {
  describe('MinIO (REQUIRE_MINIO=true)', () => {
    it(`precisa estar no ar em ${endpoint}`, () => {
      throw new Error(`MinIO não respondeu em ${endpoint}, mas REQUIRE_MINIO=true`);
    });
  });
}

const suite = available ? describe : describe.skip;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const storage = new S3StorageService({ client: s3, bucket, publicUrl: publicBase });
const created: string[] = [];

async function newUpload(contentType = 'image/png', service = storage): Promise<UploadResponse> {
  const up = await service.createUpload(contentType);
  created.push(up.key);
  return up;
}

// Campos primeiro e o arquivo por ÚLTIMO, como exige o S3.
function send(
  up: UploadResponse,
  body: Uint8Array,
  options: { fields?: Record<string, string>; fileType?: string } = {},
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(options.fields ?? up.fields)) form.append(name, value);
  form.append('file', new Blob([body], { type: options.fileType ?? 'image/png' }), 'imagem');
  return fetch(up.uploadUrl, { method: 'POST', body: form });
}

// O secret nunca pode aparecer. (No MinIO local o secret é igual ao access key id, que aparece
// legitimamente em X-Amz-Credential: nesse caso só vale a checagem dos nomes dos campos; o teste
// unitário offline, com secret distinto, cobre o conteúdo.)
function expectNoSecret(value: unknown): void {
  if (secretAccessKey !== accessKeyId) {
    expect(JSON.stringify(value)).not.toContain(secretAccessKey);
  }
}

async function publicGet(key: string): Promise<Response> {
  return fetch(`${publicBase}/${key}`);
}

// Limpa os objetos criados (um único DeleteObjects; chaves inexistentes são ignoradas).
afterAll(async () => {
  if (!available) return;
  if (created.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: created.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  s3.destroy();
}, 30_000);

suite('upload direto para o MinIO (presigned POST)', () => {
  it('PNG válido: sobe, e a publicUrl devolve 200 com os mesmos bytes e content-type', async () => {
    const up = await newUpload();
    const res = await send(up, PNG);
    expect([200, 201, 204]).toContain(res.status);

    const got = await publicGet(up.key);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    expect(storage.publicUrl(up.key)).toBe(`${publicBase}/${up.key}`);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
  ])('%s: sobe e é servido com o content-type declarado', async (type, ext) => {
    const up = await newUpload(type);
    expect(up.key.endsWith(`.${ext}`)).toBe(true);
    expect([200, 201, 204]).toContain((await send(up, PNG, { fileType: type })).status);
    expect((await publicGet(up.key)).headers.get('content-type')).toBe(type);
  });

  it('arquivo de exatamente 2 MB é aceito', async () => {
    const up = await newUpload();
    const res = await send(up, Buffer.alloc(MAX_UPLOAD_BYTES, 1));
    expect([200, 201, 204]).toContain(res.status);
    expect((await publicGet(up.key)).status).toBe(200);
  });

  it('arquivo maior que 2 MB: rejeitado pelo próprio S3 (4xx) e o objeto NÃO existe', async () => {
    const up = await newUpload();
    const res = await send(up, Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.text()).toMatch(/EntityTooLarge|too large|exceed/i);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('Content-Type diferente do pedido: rejeitado e o objeto NÃO existe', async () => {
    const up = await newUpload('image/png');
    const res = await send(up, PNG, { fields: { ...up.fields, 'Content-Type': 'text/html' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('sem o campo Content-Type: rejeitado', async () => {
    const up = await newUpload();
    const fields = Object.fromEntries(
      Object.entries(up.fields).filter(([name]) => name !== 'Content-Type'),
    );
    const res = await send(up, PNG, { fields });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('key adulterada nos fields: rejeitada (e nada é gravado nem na chave original nem na nova)', async () => {
    const up = await newUpload();
    const other = `products/00000000-0000-4000-8000-000000000000.png`;
    created.push(other);
    const res = await send(up, PNG, { fields: { ...up.fields, key: other } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await publicGet(other)).status).toBe(404);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('key fora de products/ (path traversal): rejeitada', async () => {
    const up = await newUpload();
    const res = await send(up, PNG, { fields: { ...up.fields, key: '../escape.png' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('assinatura adulterada: rejeitada', async () => {
    const up = await newUpload();
    const signature = up.fields['X-Amz-Signature']!;
    const forged = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
    const res = await send(up, PNG, { fields: { ...up.fields, 'X-Amz-Signature': forged } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('campo extra fora da política (ex.: x-amz-acl): rejeitado', async () => {
    const up = await newUpload();
    const res = await send(up, PNG, { fields: { ...up.fields, 'x-amz-acl': 'public-read-write' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('política expirada: rejeitada pelo S3', async () => {
    const shortLived = new S3StorageService({
      client: s3,
      bucket,
      publicUrl: publicBase,
      expiresSeconds: 1,
    });
    const up = await newUpload('image/png', shortLived);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const res = await send(up, PNG);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toMatch(/expired|Expired/);
    expect((await publicGet(up.key)).status).toBe(404);
  });

  it('a política dos fields expira em ~5 minutos e os fields não contêm o secret', async () => {
    const up = await newUpload();
    const policy = JSON.parse(Buffer.from(up.fields.Policy!, 'base64').toString());
    const seconds = (new Date(policy.expiration).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(280);
    expect(seconds).toBeLessThanOrEqual(305);
    expectNoSecret(up);
    expectNoSecret(policy);
    expect(Object.keys(up.fields).sort()).toEqual(
      [
        'Content-Type',
        'Policy',
        'X-Amz-Algorithm',
        'X-Amz-Credential',
        'X-Amz-Date',
        'X-Amz-Signature',
        'bucket',
        'key',
      ].sort(),
    );
  });

  it('LIMITAÇÃO CONHECIDA: o S3 não valida o conteúdo real, só o tipo declarado', async () => {
    const up = await newUpload('image/png');
    const notAnImage = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await send(up, notAnImage, { fileType: 'image/png' });
    // O objeto entra e é servido como image/png (o navegador não o executa como HTML).
    expect([200, 201, 204]).toContain(res.status);
    expect((await publicGet(up.key)).headers.get('content-type')).toBe('image/png');
  });
});

suite('ponta a ponta: login -> upload -> produto -> imagem pública', () => {
  const pool = createPool(testDatabaseUrl());

  beforeEach(async () => {
    await resetDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('a imagem enviada ao MinIO aparece no produto e é baixável', async () => {
    const ctx = await buildAdminCtx(pool, storage);

    const up = await ctx.post('/admin/uploads/product-image', { contentType: 'image/png' });
    expect(up.status).toBe(200);
    const upload = up.body.data as UploadResponse;
    created.push(upload.key);
    expect(upload.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(upload.uploadUrl).toBe(publicBase);
    expectNoSecret(up.body);

    expect([200, 201, 204]).toContain((await send(upload, PNG)).status);

    const product = await ctx.post('/admin/products', {
      name: 'Produto com foto',
      description: 'Teste ponta a ponta',
      category: 'Teste',
      priceCents: 12345,
      initialStock: 3,
      imageKey: upload.key,
    });
    expect(product.status).toBe(201);

    const pub = await request(ctx.app).get(`/products/${product.body.data.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.imageUrl).toBe(`${publicBase}/${upload.key}`);

    const image = await fetch(pub.body.data.imageUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('tipo inválido pela API real: 400 INVALID_FILE_TYPE e nenhuma política é emitida', async () => {
    const ctx = await buildAdminCtx(pool, storage);
    const res = await ctx.post('/admin/uploads/product-image', { contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(JSON.stringify(res.body)).not.toContain('Policy');
  });
});
