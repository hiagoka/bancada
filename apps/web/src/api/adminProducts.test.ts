import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminProduct,
  getAdminProduct,
  listAdminProducts,
  requestProductImageUpload,
  updateAdminProduct,
} from './adminProducts';

const ID = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
const product = {
  id: ID,
  slug: 'teclado',
  name: 'Teclado',
  description: 'd',
  category: 'Teclados',
  priceCents: 34990,
  stock: 3,
  imageUrl: null,
  active: true,
  imageKey: null,
  createdAt: '2026-10-27T12:00:00.000Z',
  updatedAt: '2026-10-27T12:00:00.000Z',
};
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
const mockFetch = (response: () => Response) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());
afterEach(() => vi.restoreAllMocks());

const call = (spy: ReturnType<typeof mockFetch>) => {
  const [url, init] = spy.mock.calls[0] ?? [];
  return {
    url: String(url),
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    headers: new Headers(init?.headers),
    credentials: init?.credentials,
  };
};

describe('api/adminProducts', () => {
  it('list: GET /admin/products sem filtros', async () => {
    const spy = mockFetch(() => ok([product]));
    await expect(listAdminProducts({})).resolves.toEqual([product]);
    const c = call(spy);
    expect(c.url).toMatch(/\/admin\/products$/);
    expect(c.method).toBe('GET');
    expect(c.credentials).toBe('include');
  });

  it('list: q e active viram query string codificada (q vazio e "all" não vão)', async () => {
    const spy = mockFetch(() => ok([]));
    await listAdminProducts({ q: ' mouse & cia ', active: 'false' });
    expect(call(spy).url).toMatch(/\/admin\/products\?q=mouse\+%26\+cia&active=false$/);
    spy.mockClear();
    await listAdminProducts({ q: '   ', active: 'all' });
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/admin\/products$/);
  });

  it('get: GET /admin/products/:id com o id codificado e validado (com movements)', async () => {
    const spy = mockFetch(() => ok({ ...product, movements: [] }));
    await expect(getAdminProduct(ID)).resolves.toMatchObject({ id: ID, movements: [] });
    expect(call(spy).url).toMatch(new RegExp(`/admin/products/${ID}$`));
  });

  it('create: POST com SÓ os campos do schema estrito (sem active, stock nem slug)', async () => {
    const spy = mockFetch(() => ok(product, 201));
    await createAdminProduct({
      name: 'Teclado',
      description: 'd',
      category: 'Teclados',
      priceCents: 34990,
      initialStock: 5,
      imageKey: 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png',
    });
    const c = call(spy);
    expect(c.method).toBe('POST');
    expect(c.headers.get('X-Requested-With')).toBe('bancada-web');
    expect(c.body).toEqual({
      name: 'Teclado',
      description: 'd',
      category: 'Teclados',
      priceCents: 34990,
      initialStock: 5,
      imageKey: 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png',
    });
  });

  it('create: campo fora do schema estrito (active) é recusado antes da rede', async () => {
    const spy = mockFetch(() => ok(product, 201));
    await expect(
      createAdminProduct({
        name: 'T',
        description: 'd',
        category: 'c',
        priceCents: 100,
        initialStock: 0,
        // @ts-expect-error o schema estrito não aceita active na criação
        active: true,
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('create: sem imagem, o corpo NÃO tem imageKey', async () => {
    const spy = mockFetch(() => ok(product, 201));
    await createAdminProduct({
      name: 'T',
      description: 'd',
      category: 'c',
      priceCents: 100,
      initialStock: 0,
    });
    expect(Object.keys(call(spy).body)).not.toContain('imageKey');
  });

  it('create: entrada inválida nem chega à rede', async () => {
    const spy = mockFetch(() => ok(product));
    await expect(
      createAdminProduct({
        name: '',
        description: 'd',
        category: 'c',
        priceCents: 1.5,
        initialStock: 0,
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('update: PATCH só com os campos enviados; imageKey null remove (D16)', async () => {
    const spy = mockFetch(() => ok(product));
    await updateAdminProduct(ID, { name: 'Novo', imageKey: null });
    const c = call(spy);
    expect(c.method).toBe('PATCH');
    expect(c.url).toMatch(new RegExp(`/admin/products/${ID}$`));
    expect(c.body).toEqual({ name: 'Novo', imageKey: null });
  });

  it('update: sem campo nenhum é recusado antes da rede', async () => {
    const spy = mockFetch(() => ok(product));
    await expect(updateAdminProduct(ID, {})).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('upload: POST /admin/uploads/product-image com o contentType', async () => {
    const spy = mockFetch(() =>
      ok({ uploadUrl: 'http://s3/x', fields: { key: 'k' }, key: 'products/x.png' }),
    );
    await expect(requestProductImageUpload('image/png')).resolves.toEqual({
      uploadUrl: 'http://s3/x',
      fields: { key: 'k' },
      key: 'products/x.png',
    });
    const c = call(spy);
    expect(c.url).toMatch(/\/admin\/uploads\/product-image$/);
    expect(c.body).toEqual({ contentType: 'image/png' });
  });

  it('upload: tipo não permitido nem chega à rede', async () => {
    const spy = mockFetch(() => ok({}));
    await expect(requestProductImageUpload('image/gif')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
