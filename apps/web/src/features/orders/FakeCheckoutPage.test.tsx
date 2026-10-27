// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simulatePayment } from '../../api/dev';
import { ApiError, NetworkError } from '../../api/http';
import { getOrder } from '../../api/orders';
import { ORDER_ID, makeOrder } from '../../test/orderFixtures';
import { FakeCheckoutPage } from './FakeCheckoutPage';

vi.mock('../../api/orders', () => ({ getOrder: vi.fn() }));
vi.mock('../../api/dev', () => ({ simulatePayment: vi.fn() }));
const mockGetOrder = vi.mocked(getOrder);
const mockSimulate = vi.mocked(simulatePayment);

const user = userEvent.setup();
let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
  invalidate = vi.spyOn(client, 'invalidateQueries');
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/checkout-simulado/${ORDER_ID}`]}>
        <Routes>
          <Route path="/checkout-simulado/:id" element={<FakeCheckoutPage />} />
          <Route path="/pedido/:id" element={<p>PAGINA DO PEDIDO</p>} />
          <Route path="/" element={<p>CATALOGO</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGetOrder.mockReset();
  mockSimulate.mockReset();
  mockGetOrder.mockResolvedValue(makeOrder());
});

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const result = () =>
  screen
    .getAllByRole('status')
    .map((e) => e.textContent)
    .join(' ');
const ready = () => screen.findByRole('button', { name: 'Aprovar pagamento' });

describe('FakeCheckoutPage: conteúdo', () => {
  it('faixa "MODO SIMULADO: nenhum dinheiro real é cobrado", resumo do pedido e 4 botões', async () => {
    renderPage();
    await ready();
    expect(screen.getByRole('note').textContent).toBe(
      'MODO SIMULADO: nenhum dinheiro real é cobrado',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.body.textContent).toMatch(/Mouse Sem Fio Ergonômico/);
    expect(document.body.textContent).toMatch(/R\$\s?547,00/);
    for (const name of [
      'Aprovar pagamento',
      'Recusar pagamento',
      'Cancelar pedido',
      'Pagar valor diferente',
    ]) {
      expect(button(name)).toBeTruthy();
    }
    expect(
      screen.getByText(
        /R\$\s?537,00 em vez de R\$\s?547,00: testa a proteção contra valor adulterado/,
      ),
    ).toBeTruthy();
  });

  it('não exibe dados de cliente', async () => {
    mockGetOrder.mockResolvedValue({
      ...makeOrder(),
      customer: { name: 'Ana Souza', email: 'a@b.co' },
    } as never);
    renderPage();
    await ready();
    expect(document.body.textContent).not.toMatch(/Ana Souza|a@b\.co/);
  });
});

describe('FakeCheckoutPage: payload de cada botão', () => {
  it.each([
    ['Aprovar pagamento', { orderId: ORDER_ID, status: 'approved', amountCents: undefined }],
    ['Recusar pagamento', { orderId: ORDER_ID, status: 'rejected', amountCents: undefined }],
    ['Cancelar pedido', { orderId: ORDER_ID, status: 'cancelled', amountCents: undefined }],
    ['Pagar valor diferente', { orderId: ORDER_ID, status: 'approved', amountCents: 53700 }], // 54700 - 1000
  ])('%s', async (name, payload) => {
    mockSimulate.mockResolvedValue({ outcome: 'no_change' });
    renderPage();
    await ready();
    await user.click(button(name));
    await waitFor(() => expect(mockSimulate).toHaveBeenCalledTimes(1));
    expect(mockSimulate).toHaveBeenCalledWith(payload);
  });

  it('valor diferente com total pequeno: soma R$ 1,00 (total - R$ 10,00 ficaria abaixo de R$ 1,00)', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ totalCents: 1099 }));
    mockSimulate.mockResolvedValue({ outcome: 'amount_mismatch' });
    renderPage();
    await ready();
    await user.click(button('Pagar valor diferente'));
    await waitFor(() => expect(mockSimulate).toHaveBeenCalled());
    expect(mockSimulate).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      status: 'approved',
      amountCents: 1199,
    });
  });
});

describe('FakeCheckoutPage: resultado por outcome', () => {
  it("recusar: 'Pagamento recusado…' e continua na página (o pedido segue pendente)", async () => {
    mockSimulate.mockResolvedValue({ outcome: 'no_change' });
    renderPage();
    await ready();
    await user.click(button('Recusar pagamento'));
    await waitFor(() =>
      expect(result()).toContain(
        'Pagamento recusado. O pedido continua aguardando pagamento; você pode tentar de novo.',
      ),
    );
    expect(screen.queryByText('PAGINA DO PEDIDO')).toBeNull();
    expect(button('Aprovar pagamento').getAttribute('aria-disabled')).toBe('false');
  });

  it('valor diferente (amount_mismatch): mensagem de valor, sem navegar', async () => {
    mockSimulate.mockResolvedValue({ outcome: 'amount_mismatch' });
    renderPage();
    await ready();
    await user.click(button('Pagar valor diferente'));
    await waitFor(() =>
      expect(result()).toContain(
        'O valor pago não confere com o pedido. O pagamento não foi aceito.',
      ),
    );
    expect(screen.queryByText('PAGINA DO PEDIDO')).toBeNull();
  });

  it('aprovar (applied): navega para /pedido/:id', async () => {
    mockSimulate.mockResolvedValue({ outcome: 'applied' });
    renderPage();
    await ready();
    await user.click(button('Aprovar pagamento'));
    expect(await screen.findByText('PAGINA DO PEDIDO')).toBeTruthy();
  });

  it('cancelar (applied): navega para /pedido/:id', async () => {
    mockSimulate.mockResolvedValue({ outcome: 'applied' });
    renderPage();
    await ready();
    await user.click(button('Cancelar pedido'));
    expect(await screen.findByText('PAGINA DO PEDIDO')).toBeTruthy();
  });

  it.each([
    ['invalid_transition', /não é permitida/],
    ['duplicate', /já foi registrado/],
    ['payment_not_found', /não encontrou o pagamento/],
    ['no_change', /Nada mudou/],
  ])('outcome %s: mensagem neutra, sem navegar', async (outcome, pattern) => {
    mockSimulate.mockResolvedValue({ outcome });
    renderPage();
    await ready();
    await user.click(button('Aprovar pagamento'));
    await waitFor(() => expect(result()).toMatch(pattern));
    expect(screen.queryByText('PAGINA DO PEDIDO')).toBeNull();
  });

  it('o resultado fica numa região role=status com aria-live polite', async () => {
    mockSimulate.mockResolvedValue({ outcome: 'no_change' });
    renderPage();
    await ready();
    await user.click(button('Recusar pagamento'));
    await waitFor(() => expect(result()).toMatch(/Pagamento recusado/));
    const region = screen
      .getAllByRole('status')
      .find((e) => e.textContent?.includes('Pagamento recusado'));
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('FakeCheckoutPage: bloqueios', () => {
  it('durante a chamada: botões aria-disabled e um segundo clique não envia outra requisição', async () => {
    let finish!: (v: { outcome: string }) => void;
    mockSimulate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await ready();
    await user.click(button('Recusar pagamento'));
    await waitFor(() =>
      expect(button('Aprovar pagamento').getAttribute('aria-disabled')).toBe('true'),
    );
    for (const name of [
      'Aprovar pagamento',
      'Recusar pagamento',
      'Cancelar pedido',
      'Pagar valor diferente',
    ]) {
      expect(button(name).getAttribute('aria-disabled')).toBe('true');
    }
    await user.click(button('Aprovar pagamento'));
    await user.dblClick(button('Recusar pagamento'));
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    await act(async () => finish({ outcome: 'no_change' }));
    await waitFor(() =>
      expect(button('Aprovar pagamento').getAttribute('aria-disabled')).toBe('false'),
    );
  });

  it.each(['PAID', 'CANCELLED', 'REFUNDED'] as const)(
    'pedido %s: mostra o status, "Ver pedido" e desabilita a simulação',
    async (status) => {
      mockGetOrder.mockResolvedValue(makeOrder({ status }));
      renderPage();
      await ready();
      expect(screen.getByRole('link', { name: 'Ver pedido' }).getAttribute('href')).toBe(
        `/pedido/${ORDER_ID}`,
      );
      expect(
        screen.getByText(
          'Este pedido não está mais aguardando pagamento: a simulação está desativada.',
        ),
      ).toBeTruthy();
      for (const name of [
        'Aprovar pagamento',
        'Recusar pagamento',
        'Cancelar pedido',
        'Pagar valor diferente',
      ]) {
        expect(button(name).getAttribute('aria-disabled')).toBe('true');
        await user.click(button(name));
      }
      expect(mockSimulate).not.toHaveBeenCalled();
    },
  );
});

describe('FakeCheckoutPage: erros e invalidação', () => {
  it('404 do simulador (modo Mercado Pago): "O modo simulado não está ativo neste ambiente" + link para o pedido', async () => {
    mockSimulate.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Rota não encontrada'));
    renderPage();
    await ready();
    await user.click(button('Aprovar pagamento'));
    await waitFor(() =>
      expect(result()).toContain('O modo simulado não está ativo neste ambiente.'),
    );
    expect(screen.getByRole('link', { name: 'Ver pedido' }).getAttribute('href')).toBe(
      `/pedido/${ORDER_ID}`,
    );
  });

  it('API fora do ar ao simular: mensagem de rede', async () => {
    mockSimulate.mockRejectedValue(new NetworkError());
    renderPage();
    await ready();
    await user.click(button('Aprovar pagamento'));
    await waitFor(() =>
      expect(result()).toContain('A API está fora do ar. Tente de novo em instantes.'),
    );
  });

  it('erro inesperado: mensagem genérica', async () => {
    mockSimulate.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderPage();
    await ready();
    await user.click(button('Aprovar pagamento'));
    await waitFor(() => expect(result()).toContain('Não foi possível simular o pagamento.'));
  });

  it('depois de CADA chamada (sucesso ou erro) invalida [order, id] e [products]', async () => {
    mockSimulate
      .mockResolvedValueOnce({ outcome: 'no_change' })
      .mockRejectedValueOnce(new NetworkError());
    renderPage();
    await ready();
    await user.click(button('Recusar pagamento'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', ORDER_ID] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
    invalidate.mockClear();
    await waitFor(() =>
      expect(button('Recusar pagamento').getAttribute('aria-disabled')).toBe('false'),
    );
    await user.click(button('Recusar pagamento'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', ORDER_ID] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('pedido 404: "Pedido não encontrado" e nenhum botão de simulação', async () => {
    mockGetOrder.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    renderPage();
    expect(await screen.findByText('Pedido não encontrado.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar pagamento' })).toBeNull();
  });
});
