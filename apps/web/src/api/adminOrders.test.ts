import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelAdminOrder, listAdminOrders } from './adminOrders';

const ID = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
const order = {
  id: ID,
  status: 'PENDING',
  items: [{ productId: ID, productName: 'Mouse', unitPriceCents: 24900, quantity: 2 }],
  totalCents: 49800,
  checkoutUrl: null,
  paidAt: null,
  createdAt: '2026-10-27T12:00:00.000Z',
  customer: { name: 'Ana', email: 'ana@example.com' },
  cancellable: true,
};
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const mockFetch = (response: () => Response) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());
afterEach(() => vi.restoreAllMocks());

describe('api/adminOrders', () => {
  it('list: GET /admin/orders?page=1 sem status (status "all" não vai)', async () => {
    const spy = mockFetch(() => ok({ items: [order], page: 1, pageSize: 20, total: 1 }));
    const page = await listAdminOrders({ status: 'all', page: 1 });
    expect(page.items[0]?.cancellable).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/admin\/orders\?page=1$/);
    expect(spy.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('list: status e página na query', async () => {
    const spy = mockFetch(() => ok({ items: [], page: 3, pageSize: 20, total: 41 }));
    await listAdminOrders({ status: 'PAID', page: 3 });
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/admin\/orders\?status=PAID&page=3$/);
  });

  it('list: resposta fora do contrato é rejeitada', async () => {
    mockFetch(() => ok({ items: [{ id: 1 }], page: 1, pageSize: 20, total: 1 }));
    await expect(listAdminOrders({ status: 'all', page: 1 })).rejects.toThrow();
  });

  it('cancel: POST /admin/orders/:id/cancel com corpo {} e header CSRF', async () => {
    const spy = mockFetch(() => ok({ ...order, status: 'CANCELLED', cancellable: false }));
    const cancelled = await cancelAdminOrder(ID);
    expect(cancelled.status).toBe('CANCELLED');
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toMatch(new RegExp(`/admin/orders/${ID}/cancel$`));
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('bancada-web');
  });
});
