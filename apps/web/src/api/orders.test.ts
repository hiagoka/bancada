import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrder } from './orders';
import { ApiError } from './http';

const orderId = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';
const productId = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';

const publicOrder = {
  id: orderId,
  status: 'PENDING',
  items: [{ productId, productName: 'Mouse', unitPriceCents: 24900, quantity: 2 }],
  totalCents: 49800,
  checkoutUrl: 'http://localhost:5173/checkout-simulado/' + orderId,
  pix: null,
  paidAt: null,
  createdAt: '2026-10-27T12:00:00.000Z',
};

const input = {
  customer: { name: 'Ana Souza', email: 'ana@example.com' },
  items: [{ productId, quantity: 2 }],
};

function mockFetch(status: number, body: unknown) {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const call = () => {
    const [url, init] = spy.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
  };
  return { spy, call };
}

afterEach(() => vi.restoreAllMocks());

describe('createOrder', () => {
  it('POST /orders com Idempotency-Key e os headers de segurança', async () => {
    const { call } = mockFetch(201, { data: publicOrder });
    await createOrder(input, 'chave-123');
    const { url, init, headers } = call();
    expect(url).toMatch(/\/orders$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(headers.get('Idempotency-Key')).toBe('chave-123');
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('o corpo tem só customer e items: NENHUM campo de preço ou extra', async () => {
    const { call } = mockFetch(201, { data: publicOrder });
    await createOrder(input, 'k');
    expect(call().body).toEqual(input);
    expect(Object.keys(call().body).sort()).toEqual(['customer', 'items']);
    expect(Object.keys(call().body.items[0]).sort()).toEqual(['productId', 'quantity']);
    expect(JSON.stringify(call().body)).not.toMatch(/price|total|cents/i);
  });

  it('descarta campos extras que alguém passe por engano (mesmo com cast)', async () => {
    const { call } = mockFetch(201, { data: publicOrder });
    const dirty = {
      ...input,
      totalCents: 1,
      items: [{ productId, quantity: 2, priceCents: 1, unitPriceCents: 1 }],
    };
    await createOrder(dirty as never, 'k');
    expect(call().body).toEqual(input);
  });

  it('201 (criado) e 200 (replay) têm o mesmo resultado para o web', async () => {
    mockFetch(201, { data: publicOrder });
    const created = await createOrder(input, 'k');
    vi.restoreAllMocks();
    mockFetch(200, { data: publicOrder });
    const replay = await createOrder(input, 'k');
    expect(replay).toEqual(created);
    expect(created.id).toBe(orderId);
    expect(created).not.toHaveProperty('customer');
  });

  it('resposta fora do publicOrderSchema: ApiError INTERNAL_ERROR', async () => {
    mockFetch(201, { data: { ...publicOrder, status: 'XYZ' } });
    await expect(createOrder(input, 'k')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('erros da API viram ApiError com code e details', async () => {
    mockFetch(409, {
      error: {
        code: 'OUT_OF_STOCK',
        message: 'x',
        details: [{ productId, requested: 3, available: 1 }],
      },
    });
    const error = (await createOrder(input, 'k').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('OUT_OF_STOCK');
    expect(error.details).toEqual([{ productId, requested: 3, available: 1 }]);
  });
});
