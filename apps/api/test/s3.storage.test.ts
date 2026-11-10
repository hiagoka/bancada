import { S3Client } from '@aws-sdk/client-s3';
import { adminProductInputSchema } from '@bancada/contracts';
import { S3StorageService, createS3Storage } from '../src/modules/storage/s3.storage.js';

// Offline: o presigned POST é calculado localmente (nenhuma chamada de rede).
const SECRET = 'segredo-super-secreto-do-s3';
const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
  credentials: { accessKeyId: 'AKIATESTE', secretAccessKey: SECRET },
});

function build(options: { expiresSeconds?: number; publicUrl?: string } = {}) {
  return new S3StorageService({
    client,
    bucket: 'meu-bucket',
    publicUrl: options.publicUrl ?? 'http://localhost:9000/meu-bucket',
    ...options,
  });
}

function policyOf(fields: Record<string, string>): {
  expiration: string;
  conditions: (unknown[] | Record<string, string>)[];
} {
  return JSON.parse(Buffer.from(fields.Policy!, 'base64').toString());
}

describe('S3StorageService.createUpload', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('%s: chave products/<uuid v4>.%s que casa com o imageKey do contracts', async (type, ext) => {
    const upload = await build().createUpload(type);
    expect(upload.key).toMatch(
      new RegExp(
        `^products/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${ext}$`,
      ),
    );
    const valid = {
      name: 'P',
      description: 'd',
      category: 'c',
      priceCents: 1,
      initialStock: 0,
      imageKey: upload.key,
    };
    expect(adminProductInputSchema.safeParse(valid).success).toBe(true);
  });

  it('uploadUrl aponta para o bucket (path style) e fields.key é a chave devolvida', async () => {
    const upload = await build().createUpload('image/png');
    expect(upload.uploadUrl).toBe('http://localhost:9000/meu-bucket');
    expect(upload.fields.key).toBe(upload.key);
    expect(upload.fields.bucket).toBe('meu-bucket');
    expect(upload.fields['Content-Type']).toBe('image/png');
  });

  it('cada chamada gera uma chave diferente', async () => {
    const storage = build();
    const keys = await Promise.all(
      Array.from({ length: 10 }, () => storage.createUpload('image/png')),
    );
    expect(new Set(keys.map((k) => k.key)).size).toBe(10);
  });

  it('a política impõe tamanho 0..2 MB, Content-Type exato, key exata e bucket', async () => {
    const upload = await build().createUpload('image/webp');
    const { conditions } = policyOf(upload.fields);
    expect(conditions).toContainEqual(['content-length-range', 0, 2 * 1024 * 1024]);
    expect(conditions).toContainEqual({ 'Content-Type': 'image/webp' });
    expect(conditions).toContainEqual({ key: upload.key });
    expect(conditions).toContainEqual({ bucket: 'meu-bucket' });
  });

  it('a política expira em ~5 minutos (300 s)', async () => {
    const before = Date.now();
    const upload = await build().createUpload('image/png');
    const { expiration } = policyOf(upload.fields);
    const seconds = (new Date(expiration).getTime() - before) / 1000;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(302);
  });

  it('expiração injetável (testes)', async () => {
    const before = Date.now();
    const upload = await build({ expiresSeconds: 2 }).createUpload('image/png');
    const seconds = (new Date(policyOf(upload.fields).expiration).getTime() - before) / 1000;
    expect(seconds).toBeLessThanOrEqual(4);
  });

  it('os fields só têm campos de assinatura/política: NUNCA o secret', async () => {
    const upload = await build().createUpload('image/png');
    expect(Object.keys(upload.fields).sort()).toEqual(
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
    const dump = JSON.stringify(upload) + Buffer.from(upload.fields.Policy!, 'base64').toString();
    expect(dump).not.toContain(SECRET);
    expect(upload.fields.Policy).not.toContain(SECRET);
  });

  it.each([
    'application/pdf',
    'image/gif',
    'image/svg+xml',
    'text/html',
    '',
    'IMAGE/PNG',
    'image/png; x=1',
  ])('tipo %p: AppError 400 INVALID_FILE_TYPE (não VALIDATION_ERROR)', async (type) => {
    await expect(build().createUpload(type)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_FILE_TYPE',
      message: 'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP',
    });
  });
});

describe('S3StorageService.publicUrl', () => {
  it('S3_PUBLIC_URL + "/" + key, sem barra duplicada', () => {
    expect(build().publicUrl('products/a.png')).toBe(
      'http://localhost:9000/meu-bucket/products/a.png',
    );
    expect(build({ publicUrl: 'https://cdn.example.com///' }).publicUrl('products/a.png')).toBe(
      'https://cdn.example.com/products/a.png',
    );
  });
});

describe('createS3Storage: endpoint que o NAVEGADOR enxerga (S3_PUBLIC_ENDPOINT)', () => {
  const config = {
    region: 'us-east-1',
    bucket: 'bancada',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    publicUrl: 'http://localhost:9000/bancada',
    forcePathStyle: true,
  };

  it('sem presignEndpoint, o uploadUrl usa o endpoint da API', async () => {
    const storage = createS3Storage({ ...config, endpoint: 'http://minio:9000' });
    expect((await storage.createUpload('image/png')).uploadUrl).toBe('http://minio:9000/bancada');
  });

  it('com presignEndpoint, o uploadUrl usa o endereço do navegador (no Docker a API fala com minio:9000, o navegador com localhost:9000)', async () => {
    const storage = createS3Storage({
      ...config,
      endpoint: 'http://minio:9000',
      presignEndpoint: 'http://localhost:9000',
    });
    const upload = await storage.createUpload('image/png');
    expect(upload.uploadUrl).toBe('http://localhost:9000/bancada');
    expect(upload.fields.key).toBe(upload.key);
    expect(upload.fields['Content-Type']).toBe('image/png');
    expect(upload.fields.Policy).toBeTruthy();
    expect(upload.fields['X-Amz-Signature']).toBeTruthy();
  });

  it('na AWS (sem endpoint) o presignEndpoint também é respeitado se informado', async () => {
    const storage = createS3Storage({ ...config, presignEndpoint: 'http://localhost:9000' });
    expect((await storage.createUpload('image/webp')).uploadUrl).toBe(
      'http://localhost:9000/bancada',
    );
  });
});
