// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { getOrder } from '../../api/orders';
import { ORDER_ID, makeOrder } from '../../test/orderFixtures';
import { OrderPage } from './OrderPage';
import { PIX_SLOW_POLL_MS, POLL_INTERVAL_MS, POLL_LIMIT_MS, orderQueryKey } from './useOrder';
import { resetServerClock } from '../../lib/serverClock';

vi.mock('../../api/orders', () => ({ getOrder: vi.fn() }));
const mockGetOrder = vi.mocked(getOrder);

let client: QueryClient;

function renderPage(url = `/pedido/${ORDER_ID}`) {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/pedido/:id" element={<OrderPage />} />
          <Route path="/" element={<p>CATALOGO</p>} />
          <Route path="/checkout-simulado/:id" element={<p>SIMULADO</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGetOrder.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

const live = () => document.querySelector('[role=status][aria-live=polite]')?.textContent ?? '';

describe('OrderPage: estados de carregamento e erro', () => {
  it('carregando: mensagem em role=status e um único h1', async () => {
    let release!: (value: ReturnType<typeof makeOrder>) => void;
    mockGetOrder.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderPage();
    expect(screen.getAllByText('Carregando pedido…').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await act(async () => release(makeOrder()));
  });

  it('erro de rede: "A API está fora do ar" com "Tentar de novo", que refaz a consulta', async () => {
    mockGetOrder
      .mockRejectedValueOnce(new NetworkError())
      .mockRejectedValueOnce(new NetworkError());
    mockGetOrder.mockRejectedValueOnce(new NetworkError());
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A API está fora do ar.');
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Pago')).toBeTruthy();
  });

  it('404: "Pedido não encontrado" com link para o catálogo', async () => {
    mockGetOrder.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado'));
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pedido não encontrado' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar ao catálogo' }).getAttribute('href')).toBe('/');
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('erro 500: mensagem genérica com "Tentar de novo"', async () => {
    mockGetOrder.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar o pedido.',
    );
  });
});

describe('OrderPage: um teste por status', () => {
  it('PENDING sem checkoutUrl: "Aguardando pagamento" e "Estamos preparando o pagamento"', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    expect(await screen.findByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.getByText(/Estamos preparando o pagamento/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ir para o pagamento' })).toBeNull();
    expect(screen.getByText('Guarde este endereço para acompanhar seu pedido.')).toBeTruthy();
  });

  it('título com o id curto e itens com quantidade, preço unitário e subtotal em reais, mais o total', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: /Pedido #3F2504E0/ })).toBeTruthy();
    const items = screen.getAllByRole('listitem').filter((li) => li.className === '' || true);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Mouse Sem Fio Ergonômico');
    expect(text).toMatch(/2 × R\$\s?249,00/);
    expect(text).toMatch(/R\$\s?498,00/); // subtotal do mouse
    expect(text).toContain('Caneca Térmica Dev');
    expect(text).toMatch(/1 × R\$\s?49,00/);
    expect(text).toMatch(/R\$\s?547,00/); // total
    expect(items.length).toBeGreaterThan(0);
    expect(text).toMatch(/Criado em\s*27\/10\/2026/);
    expect(text).not.toContain('Pago em');
  });

  it('PENDING com checkoutUrl de mesma origem: "Ir para o pagamento" navega pelo router', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({
        createdAt: new Date().toISOString(),
        checkoutUrl: `${window.location.origin}/checkout-simulado/${ORDER_ID}`,
      }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: 'Ir para o pagamento' });
    expect(link.getAttribute('href')).toBe(`/checkout-simulado/${ORDER_ID}`);
    await userEvent.click(link);
    expect(await screen.findByText('SIMULADO')).toBeTruthy();
  });

  it('PENDING com URL externa https (checkout externo): link externo com rel noopener', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({
        createdAt: new Date().toISOString(),
        checkoutUrl: 'https://pagamento.example.com/c/1',
      }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: 'Ir para o pagamento' });
    expect(link.getAttribute('href')).toBe('https://pagamento.example.com/c/1');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd'])(
    'checkoutUrl perigoso (%s): NÃO vira link; mostra "Estamos preparando o pagamento"',
    async (url) => {
      mockGetOrder.mockResolvedValue(makeOrder({ checkoutUrl: url }));
      renderPage();
      expect(await screen.findByText(/Estamos preparando o pagamento/)).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Ir para o pagamento' })).toBeNull();
      expect(document.querySelector('a[href^="javascript"]')).toBeNull();
    },
  );

  it('PAID: confirmação clara, "Pago em" e sem botão de pagamento', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'PAID', paidAt: '2026-10-27T15:45:00.000Z', checkoutUrl: null }),
    );
    renderPage();
    expect(await screen.findByText('Pago')).toBeTruthy();
    expect(screen.getByText(/Obrigado pela compra!/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Pago em\s*27\/10\/2026/);
    expect(screen.queryByRole('link', { name: 'Ir para o pagamento' })).toBeNull();
    expect(mockGetOrder).toHaveBeenCalledTimes(1); // sem polling
  });

  it('CANCELLED: "Este pedido foi cancelado" com link "Voltar ao catálogo"', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'CANCELLED' }));
    renderPage();
    expect(await screen.findByText('Cancelado')).toBeTruthy();
    expect(screen.getByText(/Isso acontece, por exemplo/)).toBeTruthy();
    expect(screen.getByText(/o tempo\s+para pagar acaba/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar ao catálogo' }).getAttribute('href')).toBe('/');
  });

  it('REFUNDED: "O pagamento foi estornado" sem prometer devolução de produto', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'REFUNDED', paidAt: '2026-10-27T15:45:00.000Z' }),
    );
    renderPage();
    expect((await screen.findAllByText('Estornado')).length).toBeGreaterThan(0); // selo e etapa do tracker
    expect(screen.getByText('O pagamento foi estornado.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/devol/i);
  });

  it('tracker: estados escritos (Em andamento, Pendente) e aria-current na etapa atual', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    const tracker = await screen.findByRole('list', { name: 'Andamento do pedido' });
    const steps = within(tracker).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      'Pedido recebidoConcluído',
      'PagamentoEm andamento',
      'ConfirmadoPendente',
    ]);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(steps[0]?.getAttribute('aria-current')).toBeNull();
  });
});

describe('OrderPage: janela de pagamento', () => {
  it('PENDING com URL e dentro dos 30 min: avisa para não pagar de novo', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({
        createdAt: new Date().toISOString(),
        checkoutUrl: 'https://pagamento.example.com/c/1',
      }),
    );
    renderPage();
    expect(await screen.findByText(/Não pague de novo/)).toBeTruthy();
  });

  it('PENDING com mais de 30 min: "O tempo para pagar acabou", sem botão de pagamento', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({
        createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
        checkoutUrl: 'https://pagamento.example.com/c/1',
      }),
    );
    renderPage();
    expect(await screen.findByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ir para o pagamento' })).toBeNull();
  });

  it('falha ao atualizar com dados em tela: mantém o pedido e avisa', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    await screen.findByText('Aguardando pagamento');
    mockGetOrder.mockRejectedValue(new NetworkError());
    await act(async () => {
      await client.refetchQueries({ queryKey: orderQueryKey(ORDER_ID) });
    });
    expect(
      await screen.findByText('Não foi possível atualizar agora. Tentando de novo.'),
    ).toBeTruthy();
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
  });
});

describe('OrderPage: segurança e privacidade', () => {
  it('IGNORA os query params de provedores de pagamento: o status vem só da API', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PENDING' }));
    renderPage(
      `/pedido/${ORDER_ID}?collection_status=approved&status=approved&payment_id=123&merchant_order_id=9&external_reference=x`,
    );
    expect(await screen.findByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.queryByText('Pago')).toBeNull();
    expect(screen.queryByText(/Pagamento confirmado/)).toBeNull();
    // a consulta usa SÓ o id da rota
    expect(mockGetOrder.mock.calls[0]?.[0]).toBe(ORDER_ID);
  });

  it('um status forjado na query string não muda nada nem com o pedido já PAID na API (e vice-versa)', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID' }));
    renderPage(`/pedido/${ORDER_ID}?status=rejected&collection_status=cancelled`);
    expect(await screen.findByText('Pago')).toBeTruthy();
    expect(screen.queryByText('Cancelado')).toBeNull();
  });

  it('não exibe dados de cliente, mesmo que a resposta os traga por engano', async () => {
    mockGetOrder.mockResolvedValue({
      ...makeOrder(),
      customer: { name: 'Ana Souza', email: 'ana@example.com' },
      customerEmail: 'ana@example.com',
    } as never);
    renderPage();
    await screen.findByText('Aguardando pagamento');
    expect(document.body.textContent).not.toMatch(/Ana Souza|ana@example\.com/);
  });
});

describe('OrderPage: anúncios e polling', () => {
  it('a região aria-live (polite) anuncia a MUDANÇA de status', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    await screen.findByText('Aguardando pagamento');
    expect(live()).toBe('Pedido aguardando pagamento.');
    expect(
      document.querySelector('[role=status][aria-live=polite]')?.getAttribute('aria-atomic'),
    ).toBe('true');
    act(() => client.setQueryData(orderQueryKey(ORDER_ID), makeOrder({ status: 'PAID' })));
    await waitFor(() => expect(live()).toBe('Pagamento confirmado. Seu pedido está pago.'));
    expect(screen.getByText('Pago')).toBeTruthy();
  });

  it('o status do pedido que já está PAID ao abrir não gera polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID' }));
    renderPage();
    await screen.findByText('Pago');
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('depois do limite de 5 min de polling: "Ainda aguardando a confirmação do pagamento" e botão "Atualizar"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder());
    renderPage();
    await screen.findByText('Aguardando pagamento');
    expect(screen.queryByText(/Ainda aguardando a confirmação/)).toBeNull();

    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS + 1000)));
    expect(screen.getByText('Ainda aguardando a confirmação do pagamento.')).toBeTruthy();
    const calls = mockGetOrder.mock.calls.length;

    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID' }));
    await act(async () => {
      screen.getByRole('button', { name: 'Atualizar' }).click();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mockGetOrder.mock.calls.length).toBe(calls + 1);
    expect(await screen.findByText('Pago')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
  });
});

describe('OrderPage: pagamento por Pix (D34)', () => {
  const BR_CODE = '00020101021226950014br.gov.bcb.pix0136teste-copia-e-cola';
  const QR = 'data:image/png;base64,iVBORw0KGgo=';
  const pixIn = (seconds: number) => ({
    brCode: BR_CODE,
    qrCodeImage: QR,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  });

  it('PENDING com Pix: mostra o bloco "Pague com Pix" no lugar do checkout externo', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(1800), checkoutUrl: null }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Pague com Pix' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /QR Code do Pix/ }).getAttribute('src')).toBe(QR);
    expect((screen.getByLabelText('Pix copia e cola') as HTMLInputElement).value).toBe(BR_CODE);
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ir para o pagamento' })).toBeNull();
    expect(screen.queryByText(/Estamos preparando o pagamento/)).toBeNull();
    expect(screen.getByText(/Não pague de novo/)).toBeTruthy();
  });

  it('um h1 só (o bloco do Pix usa h2)', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(1800) }));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Pague com Pix' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('PAID substitui o Pix pela confirmação (QR Code e copia e cola somem)', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(1800) }));
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    act(() =>
      client.setQueryData(
        orderQueryKey(ORDER_ID),
        makeOrder({ status: 'PAID', pix: null, paidAt: '2026-10-27T15:45:00.000Z' }),
      ),
    );
    expect(await screen.findByText(/Obrigado pela compra!/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pague com Pix' })).toBeNull();
    expect(screen.queryByRole('img', { name: /QR Code/ })).toBeNull();
    expect(document.body.textContent).not.toContain(BR_CODE);
  });

  it.each(['CANCELLED', 'REFUNDED'] as const)('%s também tira o Pix da tela', async (status) => {
    mockGetOrder.mockResolvedValue(makeOrder({ status, pix: null }));
    renderPage();
    await screen.findAllByText(status === 'CANCELLED' ? 'Cancelado' : 'Estornado');
    expect(screen.queryByRole('heading', { name: 'Pague com Pix' })).toBeNull();
  });

  it('modo fake intacto: sem Pix e com checkoutUrl de mesma origem, "Ir para o pagamento" leva ao checkout simulado', async () => {
    mockGetOrder.mockResolvedValue(
      makeOrder({
        pix: null,
        createdAt: new Date().toISOString(),
        checkoutUrl: `${window.location.origin}/checkout-simulado/${ORDER_ID}`,
      }),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: 'Ir para o pagamento' });
    expect(link.getAttribute('href')).toBe(`/checkout-simulado/${ORDER_ID}`);
    expect(screen.queryByRole('heading', { name: 'Pague com Pix' })).toBeNull();
  });

  it('PENDING sem Pix e sem checkoutUrl: mensagem clara e o polling continua', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ pix: null, checkoutUrl: null }));
    renderPage();
    expect(await screen.findByText(/Estamos preparando o pagamento/)).toBeTruthy();
    const calls = mockGetOrder.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 + 100)));
    expect(mockGetOrder.mock.calls.length).toBeGreaterThan(calls);
  });

  it('o Pix aparece sozinho quando o pedido ganha a cobrança depois (polling)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ pix: null, checkoutUrl: null }));
    renderPage();
    await screen.findByText(/Estamos preparando o pagamento/);
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(1800) }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100)));
    expect(await screen.findByRole('heading', { name: 'Pague com Pix' })).toBeTruthy();
  });

  it('com Pix a página segue consultando depois de 5 minutos (e sem o botão "Atualizar")', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(30 * 60) }));
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS + 30_000)));
    const calls = mockGetOrder.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(PIX_SLOW_POLL_MS * 2 + 100)));
    expect(mockGetOrder.mock.calls.length).toBeGreaterThan(calls); // agora a cada 10 s, não a cada 3 s
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
    expect(screen.queryByText(/Ainda aguardando a confirmação/)).toBeNull();
  });

  it('o tempo zera com o pedido ainda PENDING: UMA última consulta e "O tempo para pagar acabou."', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(4) }));
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    expect(screen.queryByText('O tempo para pagar acabou.')).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(await screen.findByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR Code/ })).toBeNull();
    expect(screen.queryByLabelText('Pix copia e cola')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar ao catálogo' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Ir para o carrinho' }).getAttribute('href')).toBe(
      '/carrinho',
    );
  });

  it('a última consulta mostra PAID (pagou no último segundo): vira confirmação, não "tempo acabou"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(4) }));
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'PAID', pix: null, paidAt: new Date().toISOString() }),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(await screen.findByText(/Obrigado pela compra!/)).toBeTruthy();
    expect(screen.queryByText('O tempo para pagar acabou.')).toBeNull();
  });

  it('depois de mostrar o expirado, um PAID que chega pelo polling troca a tela para Pago (sem recarregar)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(
      makeOrder({ pix: pixIn(4), createdAt: new Date().toISOString() }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(40_000))); // zerou e passou a tolerância
    expect(await screen.findByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.getByText(/Se você já pagou, aguarde/)).toBeTruthy();
    expect(screen.queryByText(/Não pague de novo/)).toBeNull();
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'PAID', pix: null, paidAt: new Date().toISOString() }),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000))); // próximo tick do polling lento
    expect(await screen.findByText(/Obrigado pela compra!/)).toBeTruthy();
    expect(screen.queryByText('O tempo para pagar acabou.')).toBeNull();
  });

  it('a última consulta falha DE VERDADE (refetch real com a API fora do ar): não declara o tempo esgotado; "Tentar de novo" confere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(
      makeOrder({ pix: pixIn(4), createdAt: new Date().toISOString() }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    mockGetOrder.mockRejectedValue(new NetworkError());
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(await screen.findByText('Não conseguimos conferir seu pagamento.')).toBeTruthy();
    expect(screen.queryByText('O tempo para pagar acabou.')).toBeNull();

    // a API volta: "Tentar de novo" confere e, continuando PENDING, mostra o tempo esgotado
    mockGetOrder.mockResolvedValue(
      makeOrder({ pix: pixIn(-10), createdAt: new Date().toISOString() }),
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Tentar de novo' }).click();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(await screen.findByText('O tempo para pagar acabou.')).toBeTruthy();
  });

  it('com a API falhando a página MANTÉM o polling (e um PAID que chegar troca a tela)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetOrder.mockResolvedValue(
      makeOrder({ pix: pixIn(4), createdAt: new Date().toISOString() }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    mockGetOrder.mockRejectedValue(new NetworkError());
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    await screen.findByText('Não conseguimos conferir seu pagamento.');
    const calls = mockGetOrder.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(mockGetOrder.mock.calls.length).toBeGreaterThan(calls); // seguiu tentando
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'PAID', pix: null, paidAt: new Date().toISOString() }),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(await screen.findByText(/Obrigado pela compra!/)).toBeTruthy();
    expect(screen.queryByText('Não conseguimos conferir seu pagamento.')).toBeNull();
  });

  it('Pix já vencido ao abrir a página (pedido ainda PENDING): mostra que o tempo acabou, sem QR Code', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(-600) }));
    renderPage();
    expect(await screen.findByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR Code/ })).toBeNull();
    expect(document.body.textContent).not.toContain(BR_CODE);
  });

  it('a página não menciona o Mercado Pago e não mostra dados do cliente', async () => {
    mockGetOrder.mockResolvedValue({
      ...makeOrder({ pix: pixIn(1800) }),
      customer: { name: 'Ana Souza', email: 'ana@example.com' },
    } as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Pague com Pix' });
    expect(document.body.textContent).not.toMatch(/mercado/i);
    expect(document.body.textContent).not.toMatch(/Ana Souza|ana@example\.com/);
  });

  it('IGNORA query params de provedores na URL: o status e o Pix vêm só da API', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: pixIn(1800) }));
    renderPage(`/pedido/${ORDER_ID}?status=approved&payment_id=1&collection_status=approved`);
    expect(await screen.findByRole('heading', { name: 'Pague com Pix' })).toBeTruthy();
    expect(screen.queryByText(/Obrigado pela compra/)).toBeNull();
  });
});
