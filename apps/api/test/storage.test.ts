import { adminProductInputSchema } from '@bancada/contracts';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';

describe('FakeStorageService', () => {
  it('publicUrl é determinística e createUpload devolve key com a extensão certa', async () => {
    const storage = new FakeStorageService();
    expect(storage.publicUrl('products/a.png')).toBe('https://cdn.test/products/a.png');
    const upload = await storage.createUpload('image/webp');
    expect(upload.key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(upload.fields.key).toBe(upload.key);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('%s -> chave products/<uuid>.%s (casa com o imageKey do contracts)', async (type, ext) => {
    const upload = await new FakeStorageService().createUpload(type);
    expect(upload.key).toMatch(new RegExp(`^products/[0-9a-f-]{36}\\.${ext}$`));
    expect(
      adminProductInputSchema.safeParse({ ...validProduct, imageKey: upload.key }).success,
    ).toBe(true);
  });

  it('cada chamada gera uma chave diferente', async () => {
    const storage = new FakeStorageService();
    const keys = await Promise.all(
      Array.from({ length: 5 }, () => storage.createUpload('image/png')),
    );
    expect(new Set(keys.map((k) => k.key)).size).toBe(5);
  });

  it.each(['application/pdf', 'image/gif', 'image/svg+xml', 'text/html', '', 'IMAGE/PNG'])(
    'tipo %p: AppError 400 INVALID_FILE_TYPE',
    async (type) => {
      await expect(new FakeStorageService().createUpload(type)).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_FILE_TYPE',
      });
    },
  );
});

const validProduct = {
  name: 'Produto',
  description: 'Descrição',
  category: 'cat',
  priceCents: 100,
  initialStock: 1,
};
