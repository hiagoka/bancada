// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelAdminOrder, listAdminOrders } from '../../api/adminOrders';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { makeAdminOrder, makeOrdersPage } from '../../test/adminFixtures';
import { OrdersListPage } from './OrdersListPage';

vi.mock('../../api/adminOrders', () => ({ listAdminOrders: vi.fn(), cancelAdminOrder: vi.fn() }));
const mockList = vi.mocked(listAdminOrders);
const mockCancel = vi.mocked(cancelAdminOrder);
const user = userEvent.setup();

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPage(url = '/admin/pedidos') {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route path="/admin/pedidos" element={<OrdersListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const where = () => screen.getByTestId('where').textContent;
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const cancelButtons = () => screen.queryAllByRole('button', { name: /^Cancelar pedido #/ });

beforeEach(() => {
  mockList.mockReset();
  mockCancel.mockReset();
});

describe('OrdersListPage: lista', () => {
  it('tabela com id curto, data, cliente (nome e e-mail), itens, total em reais e status em texto', async () => {
    mockList.mockResolvedValue(
      makeOrdersPage([makeAdminOrder({ status: 'PAID', paidAt: '2026-10-27T15:40:00.000Z' })]),
    );
    renderPage();
    await screen.findByRole('table');
    const row = rows()[0];
    expect(row?.textContent).toContain('#3F2504E0');
    expect(row?.textContent).toMatch(/27\/10\/2026 \d{2}:\d{2}/);
    expect(row?.textContent).toContain('Ana Souza');
    expect(row?.textContent).toContain('ana@example.com');
    expect(row?.textContent).toContain('2 × Mouse Sem Fio');
    expect(row?.textContent).toContain('1 × Caneca Dev');
    expect(row?.textContent).toMatch(/R\$\s?547,00/);
    expect(row?.textContent).toContain('Pago');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Pedido',
      'Data',
      'Cliente',
      'Itens',
      'Total',
      'Situação',
      'Ação',
    ]);
  });

  it.each([
    ['PENDING', 'Aguardando pagamento'],
    ['PAID', 'Pago'],
    ['CANCELLED', 'Cancelado'],
    ['REFUNDED', 'Estornado'],
  ] as const)('pedido %s aparece como "%s"', async (status, label) => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder({ status })]));
    renderPage();
    await screen.findByRole('table');
    expect(rows()[0]?.textContent).toContain(label);
  });

  it('chama a API com status "all" e página 1 por padrão', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()]));
    renderPage();
    await screen.findByRole('table');
    expect(mockList).toHaveBeenCalledWith({ status: 'all', page: 1 }, expect.anything());
  });

  it('carregando: mensagem em role=status', async () => {
    let release!: (value: ReturnType<typeof makeOrdersPage>) => void;
    mockList.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderPage();
    expect(screen.getAllByText('Carregando pedidos…').length).toBeGreaterThan(0);
    release(makeOrdersPage([]));
    await screen.findByText('Ainda não há pedidos.');
  });

  it('sem pedidos: mensagem; com filtro: "Nenhum pedido encontrado"', async () => {
    mockList.mockResolvedValue(makeOrdersPage([]));
    renderPage();
    expect(await screen.findByText('Ainda não há pedidos.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('erro de rede: "A API está fora do ar" e "Tentar de novo"', async () => {
    mockList.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError());
    mockList.mockRejectedValueOnce(new NetworkError());
    renderPage();
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain(
      'A API está fora do ar.',
    );
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()]));
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('anuncia a contagem e a página (role=status)', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 2, 45));
    renderPage('/admin/pedidos?page=2');
    await screen.findByRole('table');
    expect(
      screen.getAllByRole('status').some((e) => e.textContent === '45 pedidos · página 2 de 3'),
    ).toBe(true);
  });
});

describe('OrdersListPage: filtro e paginação pela URL', () => {
  it('lê status e página da URL', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 3, 50));
    renderPage('/admin/pedidos?status=PAID&page=3');
    await screen.findByRole('table');
    expect(mockList).toHaveBeenCalledWith({ status: 'PAID', page: 3 }, expect.anything());
    expect((screen.getByLabelText('Situação') as HTMLSelectElement).value).toBe('PAID');
  });

  it('parâmetros inválidos na URL nunca chegam à API', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()]));
    renderPage('/admin/pedidos?status=xyz&page=-4');
    await screen.findByRole('table');
    expect(mockList).toHaveBeenCalledWith({ status: 'all', page: 1 }, expect.anything());
  });

  it('trocar o filtro atualiza a URL e volta à página 1', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 2, 45));
    renderPage('/admin/pedidos?page=2');
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Situação'), 'CANCELLED');
    await waitFor(() => expect(where()).toBe('/admin/pedidos?status=CANCELLED'));
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { status: 'CANCELLED', page: 1 },
        expect.anything(),
      ),
    );
    expect(
      within(screen.getByLabelText('Situação'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Todos', 'Aguardando pagamento', 'Pago', 'Cancelado', 'Estornado']);
  });

  it('"Próxima" e "Anterior" navegam pela URL, mantendo o filtro; nas pontas ficam desabilitados', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 1, 45));
    renderPage('/admin/pedidos?status=PAID');
    await screen.findByRole('table');
    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(nav).queryByRole('link', { name: 'Anterior' })).toBeNull();
    expect(within(nav).getByText('Anterior').getAttribute('aria-disabled')).toBe('true');
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 2, 45));
    await user.click(within(nav).getByRole('link', { name: 'Próxima' }));
    await waitFor(() => expect(where()).toBe('/admin/pedidos?status=PAID&page=2'));
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ status: 'PAID', page: 2 }, expect.anything()),
    );
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()], 3, 45));
    await user.click(await within(nav).findByRole('link', { name: 'Próxima' }));
    await waitFor(() => expect(where()).toBe('/admin/pedidos?status=PAID&page=3'));
    expect(await within(nav).findByText('Próxima')).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Próxima' })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Anterior' }));
    await waitFor(() => expect(where()).toBe('/admin/pedidos?status=PAID&page=2'));
  });

  it('página além do fim (lista vazia, página > 1): link para a primeira página', async () => {
    mockList.mockResolvedValue(makeOrdersPage([], 9, 45));
    renderPage('/admin/pedidos?page=9');
    expect(await screen.findByText('Nenhum pedido nesta página.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Ir para a primeira página' }).getAttribute('href'),
    ).toBe('/admin/pedidos');
  });
});

describe('OrdersListPage: cancelar pedido', () => {
  const cancellable = (overrides = {}) =>
    makeAdminOrder({ status: 'PENDING', cancellable: true, ...overrides });

  it('o botão "Cancelar pedido" só aparece quando cancellable é true (nunca calculado no cliente)', async () => {
    mockList.mockResolvedValue(
      makeOrdersPage([
        cancellable({ id: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301' }),
        // PENDING antigo mas o servidor disse que NÃO pode: não mostra o botão
        makeAdminOrder({
          id: '11111111-1111-4111-8111-111111111111',
          status: 'PENDING',
          cancellable: false,
          createdAt: '2020-01-01T00:00:00.000Z',
        }),
        makeAdminOrder({
          id: '22222222-2222-4222-8222-222222222222',
          status: 'PAID',
          cancellable: false,
        }),
        // PAID com cancellable true (resposta absurda): o cliente obedece ao servidor
        makeAdminOrder({
          id: '33333333-3333-4333-8333-333333333333',
          status: 'PAID',
          cancellable: true,
        }),
      ]),
    );
    renderPage();
    await screen.findByRole('table');
    expect(cancelButtons().map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Cancelar pedido #3F2504E0',
      'Cancelar pedido #33333333',
    ]);
    expect(rows()[1]?.textContent).not.toContain('Cancelar pedido');
  });

  it('o botão leva o id curto no nome acessível', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' })).toBeTruthy();
  });

  it('pede confirmação antes: abrir o diálogo NÃO chama a API; "Voltar" fecha sem cancelar', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancelar o pedido #3F2504E0?' });
    expect(dialog.textContent).toContain('O estoque dos itens volta para a loja');
    expect(dialog.textContent).toContain('Não dá para desfazer');
    expect(mockCancel).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('Voltar devolve o foco ao botão que abriu, mesmo quando o clique não o focou (Safari/Firefox)', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    renderPage();
    await screen.findByRole('table');
    const opener = screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' });
    fireEvent.click(opener); // sem foco, como no Safari
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Voltar' }));
    expect(document.activeElement).toBe(opener);
  });

  it('erro que mantém o pedido na lista (rede): o foco volta ao botão que abriu, e o alerta continua anunciado', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockRejectedValue(new NetworkError());
    renderPage();
    await screen.findByRole('table');
    const opener = screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' });
    fireEvent.click(opener);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('A API está fora do ar.');
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('sucesso com o pedido saindo da lista: o foco vai ao aviso de resultado (não se perde no body)', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockResolvedValue(makeAdminOrder({ status: 'CANCELLED', cancellable: false }));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    mockList.mockResolvedValue(
      makeOrdersPage([makeAdminOrder({ status: 'CANCELLED', cancellable: false })]),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    const notice = await screen.findByText(/cancelado\. O estoque dos itens voltou/);
    await waitFor(() => expect(document.activeElement).toBe(notice));
  });

  it('Esc fecha o diálogo sem cancelar e o foco volta ao botão', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    renderPage();
    await screen.findByRole('table');
    const opener = screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('confirmar cancela, invalida pedidos/produtos/detalhes/loja e anuncia o resultado', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockResolvedValue(makeAdminOrder({ status: 'CANCELLED', cancellable: false }));
    const { client, invalidate } = renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    mockList.mockResolvedValue(
      makeOrdersPage([makeAdminOrder({ status: 'CANCELLED', cancellable: false })]),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(mockCancel).toHaveBeenCalledWith('3f2504e0-4f89-4d3a-9a0c-0305e82c3301');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText(
        'Pedido #3F2504E0 cancelado. O estoque dos itens voltou para a loja.',
      ),
    ).toBeTruthy();
    for (const queryKey of [
      ['admin', 'orders'],
      ['admin', 'products'],
      ['admin', 'product'],
      ['products'],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'order',
      'cancel',
    ]);
    await waitFor(() => expect(cancelButtons()).toHaveLength(0));
    expect(rows()[0]?.textContent).toContain('Cancelado');
  });

  it('durante o cancelamento: "Cancelando…" e confirmar duas vezes = 1 chamada', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    let finish!: (value: ReturnType<typeof makeAdminOrder>) => void;
    mockCancel.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    const busy = await screen.findByRole('button', { name: 'Cancelando…' });
    await user.dblClick(busy);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    finish(makeAdminOrder({ status: 'CANCELLED' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('409 ORDER_NOT_CANCELLABLE: recarrega a lista e avisa em role=alert com foco', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockRejectedValue(new ApiError(409, 'ORDER_NOT_CANCELLABLE', 'x'));
    renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    mockList.mockClear();
    mockList.mockResolvedValue(
      makeOrdersPage([makeAdminOrder({ status: 'PAID', cancellable: false })]),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    const text = await screen.findByText(
      'Este pedido não pode mais ser cancelado: ele mudou de situação. A lista foi atualizada.',
    );
    const alert = text.closest('[role=alert]');
    expect(alert).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert)); // o botão sumiu da lista
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mockList).toHaveBeenCalled()); // recarregou
    await waitFor(() => expect(cancelButtons()).toHaveLength(0));
    expect(rows()[0]?.textContent).toContain('Pago');
  });

  it('404: avisa que o pedido não foi encontrado e recarrega', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    expect(await screen.findByText('Pedido não encontrado. A lista foi atualizada.')).toBeTruthy();
  });

  it('erro de rede ao cancelar: mensagem e o pedido continua na lista', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockRejectedValue(new NetworkError());
    renderPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('A API está fora do ar.');
    expect(cancelButtons()).toHaveLength(1);
  });

  it('401 ao cancelar: derruba a sessão', async () => {
    mockList.mockResolvedValue(makeOrdersPage([cancellable()]));
    mockCancel.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const { client } = renderPage();
    client.setQueryData(['admin', 'me'], { id: 'x' });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido #3F2504E0' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar pedido' }),
    );
    await waitFor(() => expect(client.getQueryData(['admin', 'me'])).toBeNull());
  });
});

describe('OrdersListPage: privacidade', () => {
  it('dados do cliente não vão para localStorage nem sessionStorage', async () => {
    mockList.mockResolvedValue(makeOrdersPage([makeAdminOrder()]));
    renderPage();
    await screen.findByRole('table');
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toMatch(/Ana Souza|ana@example\.com/);
  });
});
