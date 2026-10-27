// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { me } from '../../api/auth';
import { ADMIN, renderAdmin } from '../../test/adminHelpers';

vi.mock('../../api/auth', () => ({ me: vi.fn(), login: vi.fn(), logout: vi.fn() }));
const mockMe = vi.mocked(me);

beforeEach(() => {
  mockMe.mockReset();
});

describe('RequireAdmin', () => {
  it('carregando: estado neutro, sem tela de login e sem conteúdo do admin', async () => {
    let release!: (admin: typeof ADMIN) => void;
    mockMe.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { where } = renderAdmin('/admin/produtos');
    expect(screen.getByText('Verificando acesso…')).toBeTruthy();
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.queryByText('PRODUTOS')).toBeNull();
    expect(where()).toBe('/admin/produtos');
    release(ADMIN);
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
  });

  it('401: redireciona ao login com o caminho pedido (com query) codificado em next', async () => {
    mockMe.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const { where } = renderAdmin('/admin/pedidos?status=PAID');
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
    expect(where()).toBe('/admin/login?next=%2Fadmin%2Fpedidos%3Fstatus%3DPAID');
  });

  it('autenticado: renderiza a página dentro do AdminLayout', async () => {
    mockMe.mockResolvedValue(ADMIN);
    renderAdmin('/admin/pedidos');
    expect(await screen.findByText('PEDIDOS')).toBeTruthy();
    expect(screen.getByText('Ana Admin')).toBeTruthy();
  });

  it('/admin vai para /admin/produtos', async () => {
    mockMe.mockResolvedValue(ADMIN);
    const { where } = renderAdmin('/admin');
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
    expect(where()).toBe('/admin/produtos');
  });

  it('erro de rede: "A API está fora do ar" com "Tentar de novo", SEM redirecionar', async () => {
    mockMe.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError());
    const { where } = renderAdmin('/admin/produtos');
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain(
      'A API está fora do ar.',
    );
    expect(where()).toBe('/admin/produtos');
    expect(screen.queryByLabelText('Senha')).toBeNull();

    mockMe.mockResolvedValue(ADMIN);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
  });

  it('401 no meio do uso (sessão expirada) leva ao login guardando a página atual', async () => {
    mockMe.mockResolvedValue(ADMIN);
    const { client, where } = renderAdmin('/admin/pedidos');
    await screen.findByText('PEDIDOS');
    await client
      .fetchQuery({
        queryKey: ['admin', 'orders', {}],
        queryFn: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'x')),
        retry: false,
      })
      .catch(() => undefined);
    await waitFor(() => expect(where()).toBe('/admin/login?next=%2Fadmin%2Fpedidos'));
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
  });

  it('guarda o noindex enquanto montada', async () => {
    mockMe.mockResolvedValue(ADMIN);
    renderAdmin('/admin/produtos');
    await screen.findByText('PRODUTOS');
    expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain(
      'noindex',
    );
  });
});
