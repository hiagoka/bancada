// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { login, logout, me } from '../../api/auth';
import { ADMIN, renderAdmin } from '../../test/adminHelpers';

vi.mock('../../api/auth', () => ({ me: vi.fn(), login: vi.fn(), logout: vi.fn() }));
const mockMe = vi.mocked(me);
const mockLogout = vi.mocked(logout);

const user = userEvent.setup();

beforeEach(() => {
  mockMe.mockReset();
  mockLogout.mockReset();
  vi.mocked(login).mockReset();
  mockMe.mockResolvedValue(ADMIN);
  mockLogout.mockResolvedValue(undefined);
});

describe('AdminLayout', () => {
  it('header "Bancada · Admin", links Produtos e Pedidos, nome do admin, Sair, skip-link e main', async () => {
    renderAdmin('/admin/pedidos');
    await screen.findByText('PEDIDOS');
    const nav = screen.getByRole('navigation', { name: 'Administração' });
    expect(nav.textContent).toContain('Bancada');
    expect(nav.textContent).toContain('Admin');
    expect(within(nav).getByRole('link', { name: 'Produtos' }).getAttribute('href')).toBe(
      '/admin/produtos',
    );
    const orders = within(nav).getByRole('link', { name: 'Pedidos' });
    expect(orders.getAttribute('href')).toBe('/admin/pedidos');
    expect(orders.getAttribute('aria-current')).toBe('page'); // estado ativo não só por cor
    expect(within(nav).getByRole('link', { name: 'Produtos' }).getAttribute('aria-current')).toBe(
      null,
    );
    expect(within(nav).getByText('Ana Admin')).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Sair' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.queryByRole('contentinfo')).toBeNull(); // sem rodapé da loja
  });

  it('navega entre Produtos e Pedidos', async () => {
    renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    await user.click(screen.getByRole('link', { name: 'Pedidos' }));
    expect(await screen.findByText('PEDIDOS')).toBeTruthy();
  });
});

describe('Sair', () => {
  it('chama a API, limpa o cache do admin e vai ao login (replace)', async () => {
    const { client, where, router } = renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    client.setQueryData(['admin', 'products', {}], [{ id: 'dado-privado' }]);
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/admin/login');
    expect(client.getQueryData(['admin', 'products', {}])).toBeUndefined();
    expect(client.getQueryData(['admin', 'me'])).toBeNull();
    expect(screen.queryByText(/Não foi possível encerrar a sessão/)).toBeNull(); // logout normal
    // replace: voltar no histórico não devolve a página do admin
    await router.navigate(-1).catch(() => undefined);
    expect(screen.queryByText('PRODUTOS')).toBeNull();
  });

  it.each([
    ['rede', new NetworkError()],
    ['500', new ApiError(500, 'INTERNAL_ERROR', 'x')],
    ['403', new ApiError(403, 'CSRF_REJECTED', 'x')],
  ])('mesmo se a API falhar (%s) a sessão local é limpa e vai ao login', async (_n, error) => {
    mockLogout.mockRejectedValue(error);
    const { client, where } = renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    client.setQueryData(['admin', 'orders', {}], ['pedido-com-cliente']);
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
    expect(where()).toBe('/admin/login');
    expect(client.getQueryData(['admin', 'orders', {}])).toBeUndefined();
    expect(client.getQueryData(['admin', 'me'])).toBeNull();
    expect(screen.getByText(/Não foi possível encerrar a sessão no servidor/)).toBeTruthy();
  });

  it('depois de sair, abrir /admin/produtos redireciona ao login sem consultar dados em cache', async () => {
    const { router, where } = renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    mockMe.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await screen.findByLabelText('Senha');
    await router.navigate('/admin/produtos');
    await waitFor(() => expect(where()).toBe('/admin/login?next=%2Fadmin%2Fprodutos'));
    expect(screen.queryByText('PRODUTOS')).toBeNull();
  });

  it('duplo clique em Sair = 1 chamada à API', async () => {
    let finish!: () => void;
    mockLogout.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    const button = screen.getByRole('button', { name: 'Sair' });
    await user.dblClick(button);
    expect(mockLogout).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
  });
});
