// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_ID,
  apiError,
  created,
  deferred,
  mockApi,
  mouse,
  orderResponse,
  renderCheckout,
  teclado,
} from '../../test/checkoutHelpers';
import { useAnnouncer } from '../../lib/announcer';
import { useCartStore } from '../cart/cartStore';

const user = userEvent.setup();

beforeEach(() => {
  localStorage.clear();
  useCartStore.setState({ lines: [], notices: [] });
  useAnnouncer.setState({ message: '' });
});
afterEach(() => vi.restoreAllMocks());

const nameField = () => screen.getByLabelText('Nome') as HTMLInputElement;
const emailField = () => screen.getByLabelText('E-mail') as HTMLInputElement;
const payButton = () =>
  screen.getByRole('button', { name: /^(Pagar|Abrindo)/ }) as HTMLButtonElement;

async function fill(name = 'Ana Souza', email = 'ana@example.com') {
  await user.clear(nameField());
  await user.type(nameField(), name);
  await user.clear(emailField());
  await user.type(emailField(), email);
}

async function submit() {
  await user.click(payButton());
}

function cartWith(...entries: [ReturnType<typeof mouse>, number][]) {
  for (const [product, quantity] of entries) useCartStore.getState().add(product, quantity);
}

describe('envio e duplo clique', () => {
  it('duplo clique real: exatamente UMA requisição', async () => {
    cartWith([mouse(), 2]);
    const gate = deferred<Response>();
    const api = mockApi({ orders: [() => gate.promise] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();

    await user.dblClick(payButton());
    await act(async () => gate.resolve(created()));
    await waitFor(() => expect(api.orderCalls).toHaveLength(1));
    expect(api.orderCalls).toHaveLength(1);
  });

  it('o Idempotency-Key é enviado e o corpo NÃO tem preço nem campos extras', async () => {
    const product = mouse();
    cartWith([product, 2]);
    const api = mockApi({ orders: [created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill('  Ana Souza ', 'ANA@Example.com');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(1));

    const [call] = api.orderCalls;
    expect(call?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(call?.body).toEqual({
      customer: { name: 'Ana Souza', email: 'ana@example.com' },
      items: [{ productId: product.id, quantity: 2 }],
    });
    expect(JSON.stringify(call?.body)).not.toMatch(/price|total|cents/i);
  });

  it('o botão mostra o total em reais e muda quando o carrinho muda', () => {
    const product = mouse();
    cartWith([product, 2]);
    renderCheckout();
    expect(payButton().textContent).toMatch(/^Pagar R\$\s?498,00$/);
    act(() => useCartStore.getState().setQuantity(product.id, 3));
    expect(payButton().textContent).toMatch(/^Pagar R\$\s?747,00$/);
  });

  it('durante o envio: texto "Abrindo o pagamento…" e aria-disabled; depois do erro volta ao normal', async () => {
    cartWith([mouse(), 2]);
    const gate = deferred<Response>();
    mockApi({ orders: [() => gate.promise] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await waitFor(() => expect(payButton().textContent).toBe('Abrindo o pagamento…'));
    expect(payButton().getAttribute('aria-disabled')).toBe('true');
    await act(async () =>
      gate.resolve(apiError(502, 'CHECKOUT_UNAVAILABLE', { orderId: ORDER_ID })),
    );
    await waitFor(() => expect(payButton().textContent).toMatch(/^Pagar/));
    expect(payButton().getAttribute('aria-disabled')).toBe('false');
  });

  it('sem retry automático: uma falha de rede gera UMA requisição só (mesmo com retry global)', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [new TypeError('Failed to fetch')] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByRole('alert');
    await new Promise((r) => setTimeout(r, 50));
    expect(api.orderCalls).toHaveLength(1);
  });
});

describe('falha antes de enviar', () => {
  it('se não der para gerar a chave, mostra o erro genérico em vez de falhar em silêncio', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [] });
    renderCheckout();
    await fill();
    vi.stubGlobal('crypto', {}); // nem randomUUID nem getRandomValues
    await submit();
    vi.unstubAllGlobals();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Algo deu errado ao criar o pedido. Tente de novo.',
    );
    expect(api.orderCalls).toHaveLength(0);
    expect(payButton().getAttribute('aria-disabled')).toBe('false'); // dá para tentar de novo
  });
});

describe('chave de idempotência (estável e renovada na hora certa)', () => {
  it('a MESMA chave no retry depois de erro de rede', async () => {
    cartWith([mouse(), 2]);
    const api = mockApi({ orders: [new TypeError('Failed to fetch'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText(/A API está fora do ar/);
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    const [first, second] = api.keys();
    expect(second).toBe(first);
  });

  it('a MESMA chave no retry depois de CHECKOUT_UNAVAILABLE (pedido reservado)', async () => {
    cartWith([mouse(), 2]);
    const api = mockApi({
      orders: [
        apiError(502, 'CHECKOUT_UNAVAILABLE', { orderId: ORDER_ID }),
        created(orderResponse(), 200),
      ],
    });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText(
      'O pagamento não abriu, mas seu pedido está reservado. Tente pagar de novo.',
    );
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(api.keys()[0]);
  });

  it('chave NOVA quando muda a quantidade', async () => {
    const product = mouse();
    cartWith([product, 2]);
    const api = mockApi({ orders: [new TypeError('x'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByRole('alert');
    act(() => useCartStore.getState().setQuantity(product.id, 3));
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });

  it('chave NOVA quando entra outro produto', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [new TypeError('x'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByRole('alert');
    act(() => void useCartStore.getState().add(teclado(), 1));
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });

  it('chave NOVA quando muda o nome ou o e-mail', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [new TypeError('x'), new TypeError('x'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByRole('alert');
    await fill('Bruno Lima', 'ana@example.com');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    await fill('Bruno Lima', 'bruno@example.com');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(3));
    const [k1, k2, k3] = api.keys();
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it('a MESMA chave se só mudar capitalização/espaços do e-mail e do nome', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [new TypeError('x'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill('Ana Souza', 'ana@example.com');
    await submit();
    await screen.findByRole('alert');
    await fill('  Ana Souza  ', '  ANA@Example.COM ');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).toBe(api.keys()[0]);
  });

  it("chave NOVA depois de CHECKOUT_UNAVAILABLE com reason 'expired', com o aviso do tempo", async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({
      orders: [
        apiError(502, 'CHECKOUT_UNAVAILABLE', { orderId: ORDER_ID, reason: 'expired' }),
        created(),
      ],
    });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('O tempo para pagar este pedido acabou. Vamos criar um novo pedido.');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });

  it('chave NOVA depois de IDEMPOTENCY_KEY_REUSED', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [apiError(409, 'IDEMPOTENCY_KEY_REUSED'), created()] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('Não foi possível concluir o pedido. Tente de novo.');
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });

  it('chave NOVA depois de um pedido concluído (comprar os mesmos itens de novo é OUTRO pedido)', async () => {
    const product = mouse();
    cartWith([product, 2]);
    const external = vi.fn();
    const api = mockApi({
      orders: [
        created(orderResponse({ checkoutUrl: 'https://pagamento.example.com/pay/1' })),
        created(),
      ],
    });
    renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await waitFor(() => expect(external).toHaveBeenCalledTimes(1));
    expect(useCartStore.getState().lines).toEqual([]);

    act(() => void useCartStore.getState().add(product, 2));
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
  });
});

describe('erros da API', () => {
  const setupStockError = async () => {
    const a = mouse();
    const b = teclado();
    cartWith([a, 5], [b, 1]);
    const api = mockApi({
      orders: [
        apiError(409, 'OUT_OF_STOCK', [
          { productId: a.id, requested: 5, available: 2 },
          { productId: b.id, requested: 1, available: 0 },
        ]),
        created(),
      ],
    });
    const view = renderCheckout({ redirectExternal: vi.fn() });
    await fill('Ana Souza', 'ana@example.com');
    await submit();
    await screen.findByText('Alguns itens não têm estoque suficiente.');
    return { a, b, api, ...view };
  };

  it('OUT_OF_STOCK: mostra "pediu N, restam M" por item, com o nome do carrinho', async () => {
    await setupStockError();
    const alert = screen.getByRole('alert', { name: '' });
    expect(within(alert).getByText(/Mouse/).parentElement?.textContent).toBe(
      'Mouse: pediu 5, restam 2',
    );
    expect(within(alert).getByText(/Teclado/).parentElement?.textContent).toBe(
      'Teclado: pediu 1, restam 0',
    );
  });

  it('OUT_OF_STOCK: "Ajustar ao estoque disponível" ajusta o carrinho, remove o que ficou em 0 e preserva os dados', async () => {
    const { a, b } = await setupStockError();
    await user.click(screen.getByRole('button', { name: 'Ajustar ao estoque disponível' }));
    const lines = useCartStore.getState().lines;
    expect(lines.map((l) => [l.product.id, l.quantity])).toEqual([[a.id, 2]]);
    expect(lines.some((l) => l.product.id === b.id)).toBe(false);
    expect(nameField().value).toBe('Ana Souza');
    expect(emailField().value).toBe('ana@example.com');
    expect(screen.queryByText('Alguns itens não têm estoque suficiente.')).toBeNull();
    expect(useAnnouncer.getState().message).toContain('Carrinho ajustado');
  });

  it('OUT_OF_STOCK: depois de ajustar, a próxima tentativa usa chave NOVA (o carrinho mudou)', async () => {
    const { api } = await setupStockError();
    await user.click(screen.getByRole('button', { name: 'Ajustar ao estoque disponível' }));
    await submit();
    await waitFor(() => expect(api.orderCalls).toHaveLength(2));
    expect(api.keys()[1]).not.toBe(api.keys()[0]);
    expect((api.orderCalls[1]?.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('OUT_OF_STOCK: o alerta recebe o foco e é role="alert"', async () => {
    await setupStockError();
    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(alert);
  });

  it('PRODUCT_UNAVAILABLE: diz quais itens saíram e "Remover itens indisponíveis" limpa e sincroniza', async () => {
    const a = mouse();
    const b = teclado();
    cartWith([a, 1], [b, 1]);
    mockApi({ orders: [apiError(422, 'PRODUCT_UNAVAILABLE', [{ productId: b.id }])] });
    const { invalidate } = renderCheckout();
    await fill();
    await submit();
    await screen.findByText('Alguns itens saíram do catálogo.');
    expect(within(screen.getByRole('alert')).getByText('Teclado').parentElement?.textContent).toBe(
      'Teclado não está mais disponível',
    );
    await user.click(screen.getByRole('button', { name: 'Remover itens indisponíveis' }));
    expect(useCartStore.getState().lines.map((l) => l.product.id)).toEqual([a.id]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('VALIDATION_ERROR (400): mostra as mensagens do servidor sem culpar o usuário', async () => {
    cartWith([mouse(), 1]);
    mockApi({
      orders: [
        apiError(400, 'VALIDATION_ERROR', [
          { path: 'items', message: 'O valor total do pedido excede o limite permitido' },
        ]),
      ],
    });
    renderCheckout();
    await fill();
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Não conseguimos criar o pedido.');
    expect(alert.textContent).toContain('O valor total do pedido excede o limite permitido');
    expect(alert.textContent).not.toMatch(/você (errou|digitou)|culpa/i);
  });

  it('NetworkError: "A API está fora do ar. Tente de novo em instantes." e o formulário continua preenchido', async () => {
    cartWith([mouse(), 1]);
    mockApi({ orders: [new TypeError('Failed to fetch')] });
    renderCheckout();
    await fill();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A API está fora do ar. Tente de novo em instantes.',
    );
    expect(nameField().value).toBe('Ana Souza');
    expect(useCartStore.getState().lines).toHaveLength(1); // carrinho intacto
  });

  it('erro desconhecido (500): mensagem genérica', async () => {
    cartWith([mouse(), 1]);
    mockApi({ orders: [apiError(500, 'INTERNAL_ERROR')] });
    renderCheckout();
    await fill();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Algo deu errado ao criar o pedido. Tente de novo.',
    );
  });

  it('cada falha reanuncia e leva o foco ao alerta, mesmo repetida', async () => {
    cartWith([mouse(), 1]);
    mockApi({ orders: [new TypeError('x'), new TypeError('x')] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByRole('alert');
    (document.activeElement as HTMLElement).blur();
    await submit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
  });
});

describe('sucesso e redirecionamento', () => {
  it('mesma origem (modo fake): limpa o carrinho, navega pelo router e guarda o pedido no cache', async () => {
    cartWith([mouse(), 2]);
    const external = vi.fn();
    mockApi({ orders: [created()] });
    const { queryClient, invalidate } = renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await screen.findByText('SIMULADO');
    expect(useCartStore.getState().lines).toEqual([]);
    expect(external).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['order', ORDER_ID])).toMatchObject({ id: ORDER_ID });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('sem checkoutUrl e com Pix: vai para /pedido/:id e anuncia "Pedido criado. Abra o Pix para pagar."', async () => {
    cartWith([mouse(), 2]);
    mockApi({
      orders: [
        created(
          orderResponse({
            checkoutUrl: null,
            pix: {
              brCode: '00020101021226950014br.gov.bcb.pix0136teste',
              qrCodeImage: 'data:image/png;base64,iVBORw0KGgo=',
              expiresAt: '2030-01-01T12:30:00.000Z',
            },
          }),
        ),
      ],
    });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByText('PEDIDO');
    expect(useAnnouncer.getState().message).toBe('Pedido criado. Abra o Pix para pagar.');
    expect(useAnnouncer.getState().message).not.toContain('Criando');
  });

  it('modo fake: anuncia "Pedido criado. Siga para o pagamento simulado."', async () => {
    cartWith([mouse(), 2]);
    mockApi({ orders: [created()] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByText('SIMULADO');
    expect(useAnnouncer.getState().message).toBe('Pedido criado. Siga para o pagamento simulado.');
  });

  it('o "Criando seu pedido…" não sobra na região aria-live depois do redirecionamento', async () => {
    cartWith([mouse(), 2]);
    mockApi({ orders: [created()] });
    renderCheckout();
    await fill();
    await submit();
    await screen.findByText('SIMULADO');
    await waitFor(() => expect(useAnnouncer.getState().message).toBe(''), { timeout: 3500 });
  });

  it('URL externa (checkout externo): chama o redirecionamento externo e limpa o carrinho', async () => {
    cartWith([mouse(), 2]);
    const external = vi.fn();
    mockApi({
      orders: [created(orderResponse({ checkoutUrl: 'https://pagamento.example.com/c/1' }))],
    });
    renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await waitFor(() => expect(external).toHaveBeenCalledWith('https://pagamento.example.com/c/1'));
    expect(useCartStore.getState().lines).toEqual([]);
    expect(screen.queryByText('SIMULADO')).toBeNull();
  });

  it('sem checkoutUrl: vai para /pedido/:id', async () => {
    cartWith([mouse(), 2]); // total exibido = o do pedido de teste (R$ 498,00)
    mockApi({ orders: [created(orderResponse({ checkoutUrl: null }))] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('PEDIDO');
  });

  it('checkoutUrl perigoso (javascript:) NUNCA é seguido: cai em /pedido/:id', async () => {
    cartWith([mouse(), 2]); // total exibido = o do pedido de teste (R$ 498,00)
    const external = vi.fn();
    mockApi({ orders: [created(orderResponse({ checkoutUrl: 'javascript:alert(1)' }))] });
    renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await screen.findByText('PEDIDO');
    expect(external).not.toHaveBeenCalled();
  });

  it('replay (200) com a mesma chave tem o mesmo desfecho do 201', async () => {
    cartWith([mouse(), 2]); // total exibido = o do pedido de teste (R$ 498,00)
    mockApi({ orders: [created(orderResponse(), 200)] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await screen.findByText('SIMULADO');
  });
});

describe('robustez do sucesso', () => {
  it('se o redirecionamento lançar, NÃO mostra "algo deu errado": o pedido foi criado e o carrinho limpo', async () => {
    cartWith([mouse(), 2]);
    mockApi({
      orders: [created(orderResponse({ checkoutUrl: 'https://pagamento.example.com/c/1' }))],
    });
    const boom = vi.fn(() => {
      throw new Error('navegação bloqueada');
    });
    renderCheckout({ redirectExternal: boom });
    await fill();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    await submit();
    await waitFor(() => expect(boom).toHaveBeenCalled());
    expect(screen.queryByText('Algo deu errado ao criar o pedido. Tente de novo.')).toBeNull();
    expect(useCartStore.getState().lines).toEqual([]);
    process.off('unhandledRejection', unhandled);
  });

  it('total do servidor diferente do exibido: NÃO vai ao pagamento externo; abre /pedido/:id e avisa', async () => {
    cartWith([mouse(), 2]); // exibido: R$ 498,00
    const external = vi.fn();
    mockApi({
      orders: [
        created(
          orderResponse({
            totalCents: 51000,
            checkoutUrl: 'https://pagamento.example.com/c/1',
          }),
        ),
      ],
    });
    renderCheckout({ redirectExternal: external });
    await fill();
    await submit();
    await screen.findByText('PEDIDO');
    expect(external).not.toHaveBeenCalled();
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useAnnouncer.getState().message).toMatch(/total.*R\$\s?510,00/);
  });

  it('depois de ajustar o carrinho no alerta, o foco volta ao botão de pagar e o envio é anunciado', async () => {
    const a = mouse();
    cartWith([a, 5]);
    mockApi({
      orders: [apiError(409, 'OUT_OF_STOCK', [{ productId: a.id, requested: 5, available: 2 }])],
    });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await user.click(await screen.findByRole('button', { name: 'Ajustar ao estoque disponível' }));
    await waitFor(() => expect(document.activeElement).toBe(payButton()));
  });

  it('anuncia "Criando seu pedido…" ao enviar', async () => {
    cartWith([mouse(), 1]);
    const gate = deferred<Response>();
    mockApi({ orders: [() => gate.promise] });
    renderCheckout({ redirectExternal: vi.fn() });
    await fill();
    await submit();
    await waitFor(() => expect(useAnnouncer.getState().message).toContain('Criando seu pedido'));
    await act(async () => gate.resolve(created()));
  });
});

describe('formulário: validação e acessibilidade', () => {
  it('campos vazios: mensagens em PT-BR do contracts, role="alert", aria-describedby, foco no primeiro inválido e nenhuma requisição', async () => {
    cartWith([mouse(), 1]);
    const api = mockApi({ orders: [] });
    renderCheckout();
    await submit();

    const nameError = await screen.findByText('Informe seu nome');
    const emailError = await screen.findByText('Informe um e-mail válido');
    expect(nameError.getAttribute('role')).toBe('alert');
    expect(emailError.getAttribute('role')).toBe('alert');
    expect(nameField().getAttribute('aria-describedby')).toBe(nameError.id);
    expect(emailField().getAttribute('aria-describedby')).toBe(emailError.id);
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(nameField());
    expect(api.orderCalls).toHaveLength(0);
  });

  it('só o e-mail inválido: foco no e-mail', async () => {
    cartWith([mouse(), 1]);
    mockApi({ orders: [] });
    renderCheckout();
    await user.type(nameField(), 'Ana');
    await user.type(emailField(), 'nao-e-email');
    await submit();
    await screen.findByText('Informe um e-mail válido');
    expect(screen.queryByText('Informe seu nome')).toBeNull();
    expect(document.activeElement).toBe(emailField());
  });

  it('nome só com espaços é inválido', async () => {
    cartWith([mouse(), 1]);
    mockApi({ orders: [] });
    renderCheckout();
    await fill('   ', 'ana@example.com');
    await submit();
    await screen.findByText('Informe seu nome');
  });

  it('labels visíveis, autocomplete e inputMode corretos; sem validação nativa do navegador', () => {
    cartWith([mouse(), 1]);
    const { container } = renderCheckout();
    expect(nameField().autocomplete).toBe('name');
    expect(emailField().autocomplete).toBe('email');
    expect(emailField().getAttribute('inputmode')).toBe('email');
    expect(container.querySelector('form')?.noValidate).toBe(true);
    expect(screen.getByText('Você vai pagar por Pix.')).toBeTruthy();
  });

  it('resumo do pedido: itens e total em reais', () => {
    cartWith([mouse(), 2], [teclado(), 1]);
    renderCheckout();
    const summary = screen.getByRole('heading', { name: 'Resumo do pedido' }).parentElement!;
    expect(within(summary).getByText(/Mouse/)).toBeTruthy();
    expect(within(summary).getByText(/Teclado/)).toBeTruthy();
    expect(summary.textContent).toMatch(/R\$\s?1\.097,00/); // 2 × 249 + 599
  });
});
