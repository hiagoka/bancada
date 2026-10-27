// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { login, me } from '../../api/auth';
import { ADMIN, renderAdmin } from '../../test/adminHelpers';

vi.mock('../../api/auth', () => ({ me: vi.fn(), login: vi.fn(), logout: vi.fn() }));
const mockMe = vi.mocked(me);
const mockLogin = vi.mocked(login);

const user = userEvent.setup();
// Senha FICTÍCIA de teste (nunca a de nenhum ambiente real).
const PASSWORD = 'senha-ficticia-de-teste';

beforeEach(() => {
  mockMe.mockReset();
  mockLogin.mockReset();
  mockMe.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
});

async function openLogin(url = '/admin/login') {
  const view = renderAdmin(url);
  await screen.findByLabelText('Senha');
  return view;
}
const fill = async (email: string, password: string) => {
  if (email) await user.type(screen.getByLabelText('E-mail'), email);
  if (password) await user.type(screen.getByLabelText('Senha'), password);
};
const submit = () => user.click(screen.getByRole('button', { name: 'Entrar' }));

describe('LoginPage: formulário', () => {
  it('campos com label, autocomplete certo e senha mascarada; título e um h1', async () => {
    await openLogin();
    const email = screen.getByLabelText('E-mail');
    const password = screen.getByLabelText('Senha');
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.getAttribute('type')).toBe('password');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe('Entrar · Bancada Admin');
    expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain(
      'noindex',
    );
  });

  it('vazio: mensagens em PT-BR do contracts, ligadas por aria-describedby, foco no primeiro inválido', async () => {
    await openLogin();
    await submit();
    const emailError = await screen.findByText('Informe um e-mail válido');
    const passwordError = screen.getByText('Informe a senha');
    expect(emailError.getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('E-mail').getAttribute('aria-describedby')).toBe(emailError.id);
    expect(screen.getByLabelText('Senha').getAttribute('aria-describedby')).toBe(passwordError.id);
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('E-mail'));
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('e-mail válido e senha vazia: foco na senha', async () => {
    await openLogin();
    await fill('ana@bancada.test', '');
    await submit();
    await screen.findByText('Informe a senha');
    expect(screen.queryByText('Informe um e-mail válido')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Senha'));
  });
});

describe('LoginPage: sucesso', () => {
  it('sem next: vai para /admin/produtos (replace) e põe o admin em ["admin","me"]', async () => {
    mockLogin.mockResolvedValue(ADMIN);
    const { where, client } = await openLogin();
    await fill('  ANA@bancada.test ', PASSWORD);
    await submit();
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
    expect(where()).toBe('/admin/produtos');
    expect(mockLogin).toHaveBeenCalledWith({ email: 'ana@bancada.test', password: PASSWORD });
    expect(client.getQueryData(['admin', 'me'])).toEqual(ADMIN);
  });

  it('com next válido: volta à página pedida (com query)', async () => {
    mockLogin.mockResolvedValue(ADMIN);
    const { where } = await openLogin('/admin/login?next=%2Fadmin%2Fpedidos%3Fstatus%3DPAID');
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    expect(await screen.findByText('PEDIDOS')).toBeTruthy();
    expect(where()).toBe('/admin/pedidos?status=PAID');
  });

  it.each([
    ['//evil.com'],
    ['https://evil.com/admin/produtos'],
    ['/\\evil.com'],
    ['javascript:alert(1)'],
    ['/admin/../x'],
  ])('next malicioso (%s) é ignorado: vai para /admin/produtos', async (next) => {
    mockLogin.mockResolvedValue(ADMIN);
    const { where } = await openLogin(`/admin/login?next=${encodeURIComponent(next)}`);
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
    expect(where()).toBe('/admin/produtos');
  });

  it('já logado: /admin/login redireciona direto (para o next sanitizado)', async () => {
    mockMe.mockResolvedValue(ADMIN);
    const { where } = renderAdmin('/admin/login?next=%2Fadmin%2Fpedidos');
    expect(await screen.findByText('PEDIDOS')).toBeTruthy();
    expect(where()).toBe('/admin/pedidos');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('já logado com next malicioso: vai para /admin/produtos', async () => {
    mockMe.mockResolvedValue(ADMIN);
    const { where } = renderAdmin('/admin/login?next=%2F%2Fevil.com');
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
    expect(where()).toBe('/admin/produtos');
  });

  it('nada de token ou senha em localStorage/sessionStorage', async () => {
    mockLogin.mockResolvedValue(ADMIN);
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    await screen.findByText('PRODUTOS');
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain(PASSWORD);
    expect(dump.toLowerCase()).not.toMatch(/token|jwt|bancada_admin/);
  });
});

describe('LoginPage: erros', () => {
  it('401: "E-mail ou senha incorretos", senha limpa e foco na região de alerta', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x'));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    const alert = await screen.findByText('E-mail ou senha incorretos.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@bancada.test');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('a mesma mensagem para e-mail inexistente e senha errada', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x'));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    const first = (await screen.findByRole('alert')).textContent;
    await fill('', PASSWORD);
    await user.clear(screen.getByLabelText('E-mail'));
    await user.type(screen.getByLabelText('E-mail'), 'ninguem@bancada.test');
    await submit();
    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toBe(first);
  });

  it('429: "Muitas tentativas. Aguarde um minuto e tente de novo."', async () => {
    mockLogin.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'x'));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    expect(
      await screen.findByText('Muitas tentativas. Aguarde um minuto e tente de novo.'),
    ).toBeTruthy();
  });

  it('rede: "A API está fora do ar"', async () => {
    mockLogin.mockRejectedValue(new NetworkError());
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/A API está fora do ar/);
  });

  it('403 CSRF_REJECTED: mensagem genérica (sem detalhes técnicos)', async () => {
    mockLogin.mockRejectedValue(new ApiError(403, 'CSRF_REJECTED', 'header ausente'));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Não foi possível entrar. Tente de novo em instantes.');
  });

  it('o 401 do login NÃO derruba nada nem redireciona', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x'));
    const { where } = await openLogin('/admin/login?next=%2Fadmin%2Fpedidos');
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    await screen.findByText('E-mail ou senha incorretos.');
    expect(where()).toBe('/admin/login?next=%2Fadmin%2Fpedidos');
  });

  it('o erro seguinte também recebe o foco (alerta recriado)', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x'));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    await screen.findByText('E-mail ou senha incorretos.');
    await user.type(screen.getByLabelText('Senha'), PASSWORD);
    await submit();
    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
  });
});

describe('LoginPage: envio', () => {
  it('durante o envio: "Entrando…" aria-disabled e duplo clique = 1 chamada', async () => {
    let finish!: (admin: typeof ADMIN) => void;
    mockLogin.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openLogin();
    await fill('ana@bancada.test', PASSWORD);
    await submit();
    const button = await screen.findByRole('button', { name: 'Entrando…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.dblClick(button);
    await user.type(screen.getByLabelText('Senha'), '{Enter}');
    expect(mockLogin).toHaveBeenCalledTimes(1);
    await act(async () => finish(ADMIN));
    expect(await screen.findByText('PRODUTOS')).toBeTruthy();
  });
});
