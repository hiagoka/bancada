import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { PublicUrlStorageService } from '../src/modules/storage/public-url.storage.js';

describe('PublicUrlStorageService', () => {
  it('monta a URL pública com a key', () => {
    const storage = new PublicUrlStorageService('http://localhost:9000/bancada');
    expect(storage.publicUrl('products/a.png')).toBe(
      'http://localhost:9000/bancada/products/a.png',
    );
  });

  it('ignora barras no fim da base', () => {
    const storage = new PublicUrlStorageService('http://localhost:9000/bancada//');
    expect(storage.publicUrl('products/a.png')).toBe(
      'http://localhost:9000/bancada/products/a.png',
    );
  });

  it('createUpload falha com AppError explícito até a T12', async () => {
    await expect(new PublicUrlStorageService('http://x').createUpload()).rejects.toMatchObject({
      status: 501,
    });
  });
});

describe('FakeStorageService', () => {
  it('publicUrl é determinística e createUpload devolve key com a extensão certa', async () => {
    const storage = new FakeStorageService();
    expect(storage.publicUrl('products/a.png')).toBe('https://cdn.test/products/a.png');
    const upload = await storage.createUpload('image/webp');
    expect(upload.key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(upload.fields.key).toBe(upload.key);
  });
});
