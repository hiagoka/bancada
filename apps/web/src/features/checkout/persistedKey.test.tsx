// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_ID,
  apiError,
  created,
  mockApi,
  mouse,
  orderResponse,
  renderCheckout,
  teclado,
} from '../../test/checkoutHelpers';
import { useAnnouncer } from '../../lib/announcer';
import { CartPage } from '../cart/CartPage';
import { useCartStore } from '../cart/cartStore';
import { CHECKOUT_KEY_STORAGE_KEY } from './checkoutKeyStorage';

const user = userEvent.setup();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useCartStore.setState({ lines: [], notices: [] });
  useAnnouncer.setState({ message: '' });
});
afterEach(() => vi.restoreAllMocks());

const nameField = () => screen.getByLabelText('Nome') as HTMLInputElement;
const emailField = () => screen.getByLabelText('E-mail') as HTMLInputElement;
const payButton = () => screen.getByRole('button', { name: /^(Pagar|Abrindo)/ });

async function fill(name = 'Ana Souza', email = 'ana@example.com') {
  await user.clear(nameField());
  await user.type(nameField(), name);
  await user.clear(emailField());
  await user.type(emailField(), email);
}
const submit = () => user.click(payButton());
const saved = () => {
  const raw = sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY);
  return raw === null
    ? null
    : (JSON.parse(raw) as { signatureHash: string; key: string; savedAt: number });
};
const HASH = '0123456789abcdef';
const SAVED_UUID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';
const network = () => new TypeError('Failed to fetch');

describe('chave de idempotência persistida em sessionStorage', () => {
  it("grava { signatureHash, key, savedAt } em 'bancada-checkout-key' quando a chave nasce", async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [network()] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByRole('alert');
    expect(CHECKOUT_KEY_STORAGE_KEY).toBe('bancada-checkout-key');
    expect(saved()?.key).toMatch(UUID);
    expect(saved()?.signatureHash).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof saved()?.savedAt).toBe('number');
    expect(saved()?.key).toBe(api.keys()[0]);
  });

  it('remontar o checkout (reload) com o mesmo carrinho e os mesmos dados REUSA a chave', async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [network(), created()] });
    const first = renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByRole('alert');
    first.unmount(); // simula o F5: a árvore some, o sessionStorage fica

    renderCheckout({ redirectExternal: vi.fn() });
    await fill('  Ana Souza ', ' ANA@Example.com '); // a pessoa digita de novo (normalizado)
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(api.keys()[0]);
  });

  const differentSignature: [string, () => void, [string, string]][] = [
    [
      'quantidade',
      () => useCartStore.getState().setQuantity(useCartStore.getState().lines[0]!.product.id, 3),
      ['Ana Souza', 'ana@example.com'],
    ],
    [
      'produto',
      () => void useCartStore.getState().add(teclado(), 1),
      ['Ana Souza', 'ana@example.com'],
    ],
    ['nome', () => undefined, ['Bruno Lima', 'ana@example.com']],
    ['e-mail', () => undefined, ['Ana Souza', 'outro@example.com']],
  ];
  it.each(differentSignature)(
    'assinatura diferente (%s): chave NOVA e a salva é substituída',
    async (_name, change, data) => {
      useCartStore.getState().add(mouse(), 2);
      const api = mockApi({ orders: [network(), network()] });
      const first = renderCheckout();
      await fill();
      await submit();
      await screen.findByRole('alert');
      const oldKey = saved()?.key;
      first.unmount();

      act(() => change());
      renderCheckout();
      await fill(data[0], data[1]);
      await submit();
      await waitFor(() => expect(api.orderCalls).toHaveLength(2));
      expect(api.keys()[1]).not.toBe(oldKey);
      expect(saved()?.key).toBe(api.keys()[1]);
    },
  );

  it('sucesso (pedido criado e carrinho limpo): apaga a entrada do storage', async () => {
    useCartStore.getState().add(mouse(), 2);
    mockApi({
      orders: [created(orderResponse({ checkoutUrl: 'https://www.mercadopago.com.br/c/1' }))],
    });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await waitFor(() => expect(useCartStore.getState().lines).toEqual([]));
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).toBeNull();
  });

  it("renovação forçada por 'expired': grava a NOVA chave e a próxima tentativa a usa", async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({
      orders: [
        apiError(502, 'CHECKOUT_UNAVAILABLE', { orderId: ORDER_ID, reason: 'expired' }),
        created(),
      ],
    });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText(/O tempo para pagar este pedido acabou/);
    const rotated = saved()?.key;
    expect(rotated).toMatch(UUID);
    expect(rotated).not.toBe(api.keys()[0]);
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(rotated);
  });

  it('renovação forçada por IDEMPOTENCY_KEY_REUSED: grava a NOVA chave', async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [apiError(409, 'IDEMPOTENCY_KEY_REUSED'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('Não foi possível concluir o pedido. Tente de novo.');
    const rotated = saved()?.key;
    expect(rotated).toMatch(UUID);
    expect(rotated).not.toBe(api.keys()[0]);
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(rotated);
  });

  it('CHECKOUT_UNAVAILABLE sem expired: a chave salva continua a mesma', async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [apiError(502, 'CHECKOUT_UNAVAILABLE', { orderId: ORDER_ID })] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByText(/seu pedido está reservado/);
    expect(saved()?.key).toBe(api.keys()[0]);
  });
});

describe('storage ausente, corrompido ou que lança', () => {
  const corrupted: [string, string][] = [
    ['JSON inválido', '{nao-e-json'],
    ['string vazia', ''],
    ['null', 'null'],
    ['array', '[]'],
    ['sem key', JSON.stringify({ signatureHash: HASH, savedAt: Date.now() })],
    [
      'key que não é UUID',
      JSON.stringify({ signatureHash: HASH, key: 'abc-123', savedAt: Date.now() }),
    ],
    ['key com tipo errado', JSON.stringify({ signatureHash: HASH, key: 123, savedAt: Date.now() })],
    [
      'signature que não é string',
      JSON.stringify({ signature: 5, key: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301' }),
    ],
  ];

  it.each(corrupted)(
    '%s: ignora, gera chave nova válida e o envio sai correto',
    async (_name, raw) => {
      sessionStorage.setItem(CHECKOUT_KEY_STORAGE_KEY, raw);
      const product = mouse();
      useCartStore.getState().add(product, 2);
      const api = mockApi({ orders: [created()] });
      renderCheckout({ redirectExternal: vi.fn() });
      await fill();
      await submit();
      await waitFor(() => expect(api.orderCalls).toHaveLength(1));
      expect(api.keys()[0]).toMatch(UUID);
      expect(api.orderCalls[0]?.body).toEqual({
        customer: { name: 'Ana Souza', email: 'ana@example.com' },
        items: [{ productId: product.id, quantity: 2 }],
      });
    },
  );

  it('assinatura salva de OUTRO pedido nunca é reaproveitada', async () => {
    sessionStorage.setItem(
      CHECKOUT_KEY_STORAGE_KEY,
      JSON.stringify({ signatureHash: HASH, key: SAVED_UUID, savedAt: Date.now() }),
    );
    useCartStore.getState().add(mouse(), 1);
    const api = mockApi({ orders: [created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(1));
    expect(api.keys()[0]).not.toBe(SAVED_UUID);
  });

  it('sessionStorage que LANÇA (leitura e escrita): o checkout funciona como antes, com a chave em memória', async () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [network(), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByRole('alert');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(api.keys()[0]); // mesma chave (useRef), mesmo sem storage
    await waitFor(() => expect(useCartStore.getState().lines).toEqual([]));
  });

  it('sem window.sessionStorage (undefined): funciona', async () => {
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', { value: undefined, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true });
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(1));
    Object.defineProperty(window, 'sessionStorage', { value: original, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true });
  });
});

describe('ponto 1: o storage não guarda dados pessoais legíveis', () => {
  it('só hash: nem nome, nem e-mail, nem ids de produto aparecem no valor gravado', async () => {
    const product = mouse();
    useCartStore.getState().add(product, 2);
    mockApi({ orders: [network()] });
    renderCheckout();
    await fill('Ana Souza', 'ana@example.com');
    await submit();
    await screen.findByRole('alert');
    const raw = sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY) ?? '';
    expect(raw).not.toMatch(/ana/i);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('Souza');
    expect(raw).not.toContain(product.id);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['key', 'savedAt', 'signatureHash']);
  });

  it('o mesmo pedido gera sempre o mesmo hash (comparação hash salvo === hash atual)', async () => {
    useCartStore.getState().add(mouse(), 2);
    mockApi({ orders: [network(), network()] });
    const first = renderCheckout();
    await fill();
    await submit();
    await screen.findByRole('alert');
    const hash = saved()?.signatureHash;
    first.unmount();
    renderCheckout();
    await fill('  Ana Souza  ', 'ANA@example.com'); // normalizado: mesmo hash
    await submit();
    await waitFor(() => expect(saved()?.signatureHash).toBe(hash));
  });
});

describe('ponto 2a: chave com mais de 25 minutos', () => {
  const MIN = 60_000;

  it('com 24 min é REUSADA; com 26 min é IGNORADA (chave nova que substitui a salva)', async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [network(), network(), network()] });
    const t0 = 1_800_000_000_000;

    const first = renderCheckout({ now: () => t0 });
    await fill();
    await submit();
    await screen.findByRole('alert');
    first.unmount();

    const second = renderCheckout({ now: () => t0 + 24 * MIN });
    await fill();
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(api.keys()[0]); // 24 min: reusa
    second.unmount();

    renderCheckout({ now: () => t0 + 26 * MIN });
    await fill();
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(3));
    expect(api.keys()[2]).not.toBe(api.keys()[0]); // 26 min: ignora
    expect(saved()?.key).toBe(api.keys()[2]);
    expect(saved()?.savedAt).toBe(t0 + 26 * MIN);
  });

  it('a chave em MEMÓRIA também envelhece: depois de 26 min na mesma tela, gera outra', async () => {
    useCartStore.getState().add(mouse(), 2);
    const api = mockApi({ orders: [network(), network()] });
    let clock = 1_800_000_000_000;
    renderCheckout({ now: () => clock });
    await fill();
    await submit();
    await screen.findByRole('alert');
    clock += 26 * MIN;
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });

  it('savedAt no futuro (relógio maluco) é descartado', async () => {
    sessionStorage.setItem(
      CHECKOUT_KEY_STORAGE_KEY,
      JSON.stringify({ signatureHash: HASH, key: SAVED_UUID, savedAt: Date.now() + 10 * 60 * MIN }),
    );
    useCartStore.getState().add(mouse(), 1);
    const api = mockApi({ orders: [network()] });
    renderCheckout();
    await fill();
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(1));
    expect(api.keys()[0]).not.toBe(SAVED_UUID);
  });
});

describe('ponto 2b: replay devolve um pedido que NÃO está PENDING', () => {
  const closed = (status: string) => created(orderResponse({ status, checkoutUrl: null }), 200);

  it.each(['CANCELLED', 'REFUNDED'])(
    '%s: não limpa o carrinho, não redireciona, avisa e renova a chave',
    async (status) => {
      useCartStore.getState().add(mouse(), 2);
      const external = vi.fn();
      const api = mockApi({ orders: [closed(status), created()] });
      renderCheckout({ redirectExternal: external });
      await fill();
      await submit();
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Esse pedido já foi encerrado. Confira os dados e tente de novo.',
      );
      expect(useCartStore.getState().lines).toHaveLength(1); // carrinho intacto
      expect(external).not.toHaveBeenCalled();
      expect(screen.queryByText('SIMULADO')).toBeNull();
      expect(screen.queryByText('PEDIDO')).toBeNull();
      expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).toBeNull(); // chave salva descartada

      await submit(); // a nova tentativa usa chave nova
      await waitFor(() => expect(api.orderCalls).toHaveLength(2));
      expect(api.keys()[1]).not.toBe(api.keys()[0]);
    },
  );

  it('PAID (replay de um pedido já pago): vai para /pedido/:id, sem pagamento externo, e descarta a chave', async () => {
    useCartStore.getState().add(mouse(), 2);
    const external = vi.fn();
    mockApi({ orders: [closed('PAID')] });
    renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await screen.findByText('PEDIDO');
    expect(external).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).toBeNull();
  });

  it('PENDING continua sendo o sucesso normal', async () => {
    useCartStore.getState().add(mouse(), 2);
    mockApi({ orders: [created(orderResponse({ status: 'PENDING' }), 200)] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('SIMULADO');
    expect(useCartStore.getState().lines).toEqual([]);
  });
});

describe('ponto 3: carrinho vazio limpa a entrada', () => {
  it('esvaziar o carrinho (remover tudo, ajustar até zero) apaga o sessionStorage', async () => {
    const product = mouse();
    useCartStore.getState().add(product, 2);
    mockApi({ orders: [network()] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByRole('alert');
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).not.toBeNull();
    act(() => useCartStore.getState().remove(product.id));
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).toBeNull();
  });

  it('na página do carrinho, remover o último item (o checkout desmonta junto) também apaga a entrada', async () => {
    const product = mouse();
    useCartStore.getState().add(product, 1);
    mockApi({ products: [product], orders: [network()] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CartPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await fill();
    await submit();
    await screen.findByRole('alert');
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: `Remover ${product.name} do carrinho` }));
    expect(await screen.findByText('Seu carrinho está vazio.')).toBeTruthy();
    expect(sessionStorage.getItem(CHECKOUT_KEY_STORAGE_KEY)).toBeNull();
  });
});
