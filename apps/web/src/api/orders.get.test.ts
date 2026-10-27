import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { getOrder } from './orders';
import { simulatePayment } from './dev';

const id = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';
const order = {
  id,
  status: 'PENDING',
  items: [
    {
      productId: '6ba7b810-9dad-41d1-80b5-00c04fd430c8',
      productName: 'Mouse',
      unitPriceCents: 24900,
      quantity: 2,
    },
  ],
  totalCents: 49800,
  checkoutUrl: null,
  paidAt: null,
  createdAt: '2026-10-27T12:00:00.000Z',
};

function mockFetch(status: number, body: unknown) {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  const call = () => {
    const [url, init] = spy.mock.calls.at(-1) as [string, RequestInit];
    return {
      url,
      init,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
  };
  return { spy, call };
}

afterEach(() => vi.restoreAllMocks());

describe('getOrder', () => {
  it('GET /orders/:id com os headers de segurança e sem corpo', async () => {
    const { call } = mockFetch(200, { data: order });
    const result = await getOrder(id);
    expect(result.id).toBe(id);
    const { url, init, headers } = call();
    expect(url).toMatch(new RegExp(`/orders/${id}$`));
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
    expect(init.body).toBeUndefined();
  });

  it('o id vai codificado na URL (nada de injetar caminho)', async () => {
    const { call } = mockFetch(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    await getOrder('../admin/orders?x=1').catch(() => undefined);
    expect(call().url).toContain('/orders/..%2Fadmin%2Forders%3Fx%3D1');
  });

  it('valida com o publicOrderSchema (resposta fora do contrato vira ApiError)', async () => {
    mockFetch(200, { data: { ...order, status: 'XYZ' } });
    await expect(getOrder(id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('404 vira ApiError NOT_FOUND', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Pedido não encontrado' } });
    const error = (await getOrder(id).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('simulatePayment', () => {
  it('POST /dev/payments/simulate com o corpo do simulatePaymentInputSchema e devolve o outcome', async () => {
    const { call } = mockFetch(200, { data: { outcome: 'applied' } });
    await expect(simulatePayment({ orderId: id, status: 'approved' })).resolves.toEqual({
      outcome: 'applied',
    });
    const { url, init, headers, body } = call();
    expect(url).toMatch(/\/dev\/payments\/simulate$/);
    expect(init.method).toBe('POST');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
    expect(body).toEqual({ orderId: id, status: 'approved' });
  });

  it('envia amountCents só quando informado; campos extras são descartados', async () => {
    const { call } = mockFetch(200, { data: { outcome: 'amount_mismatch' } });
    await simulatePayment({ orderId: id, status: 'approved', amountCents: 48800 });
    expect(call().body).toEqual({ orderId: id, status: 'approved', amountCents: 48800 });
    await simulatePayment({ orderId: id, status: 'rejected', totalCents: 1 } as never);
    expect(call().body).toEqual({ orderId: id, status: 'rejected' });
  });

  it('valida a entrada antes de enviar (status inválido não chega à rede)', async () => {
    const { spy } = mockFetch(200, { data: { outcome: 'applied' } });
    await expect(simulatePayment({ orderId: id, status: 'pago' } as never)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('outcome desconhecido continua sendo devolvido como texto (a UI tem mensagem padrão)', async () => {
    mockFetch(200, { data: { outcome: 'algo_novo' } });
    await expect(simulatePayment({ orderId: id, status: 'approved' })).resolves.toEqual({
      outcome: 'algo_novo',
    });
  });

  it('404 (modo Mercado Pago: a rota não existe) vira ApiError 404', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
    await expect(simulatePayment({ orderId: id, status: 'approved' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
