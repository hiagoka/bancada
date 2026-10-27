import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { CheckoutForm } from '../features/checkout/CheckoutForm';
import { makeProduct } from './fixtures';

export const ORDER_ID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

export function orderResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
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
    checkoutUrl: `${window.location.origin}/checkout-simulado/${ORDER_ID}`,
    paidAt: null,
    createdAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

export const created = (order = orderResponse(), status = 201) =>
  new Response(JSON.stringify({ data: order }), { status });

export const apiError = (status: number, code: string, details?: unknown) =>
  new Response(JSON.stringify({ error: { code, message: 'Erro da API', details } }), { status });

type Step = Response | Error | (() => Promise<Response>);

// Substitui o fetch global. As respostas de POST /orders saem na ordem da fila; GET /products
// devolve o catálogo. `orderCalls` guarda cada chamada de POST /orders (headers e corpo).
export function mockApi(options: { products?: unknown[]; orders: Step[] }) {
  const queue = [...options.orders];
  const orderCalls: { headers: Headers; body: unknown }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/products')) {
      return new Response(JSON.stringify({ data: options.products ?? [] }), { status: 200 });
    }
    if (url.endsWith('/orders')) {
      orderCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      const step = queue.shift();
      if (!step) throw new Error('fila de respostas de POST /orders vazia');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step() : step;
    }
    throw new Error(`requisição inesperada: ${url}`);
  });
  return { spy, orderCalls, keys: () => orderCalls.map((c) => c.headers.get('Idempotency-Key')) };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function renderCheckout(
  options: { redirectExternal?: (url: string) => void; now?: () => number } = {},
) {
  // retry: 3 nas mutações de propósito: prova que o useCreateOrder NÃO repete sozinho.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 1 } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/carrinho']}>
        <Routes>
          <Route
            path="/carrinho"
            element={<CheckoutForm redirectExternal={options.redirectExternal} now={options.now} />}
          />
          <Route path="/checkout-simulado/:id" element={<p>SIMULADO</p>} />
          <Route path="/pedido/:id" element={<p>PEDIDO</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, invalidate };
}

export const mouse = () => makeProduct({ name: 'Mouse', priceCents: 24900, stock: 9 });
export const teclado = () => makeProduct({ name: 'Teclado', priceCents: 59900, stock: 9 });
