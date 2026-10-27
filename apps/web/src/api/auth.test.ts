import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { login, logout, me } from './auth';

const admin = { id: '6ba7b810-9dad-41d1-80b5-00c04fd430c8', email: 'a@b.co', name: 'Ana' };
afterEach(() => vi.restoreAllMocks());

const mockFetch = (response: () => Response) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());

describe('api/auth', () => {
  it('login: POST /auth/login com SÓ e-mail e senha, header CSRF e credentials include', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ data: admin }), { status: 200 }));
    await expect(login({ email: 'a@b.co', password: 'segredo-123' })).resolves.toEqual(admin);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/auth\/login$/);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('bancada-web');
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.co', password: 'segredo-123' });
  });

  it('login: normaliza o e-mail pelo schema do contracts', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ data: admin }), { status: 200 }));
    await login({ email: '  A@B.co ', password: 'x' });
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
  });

  it('login: entrada inválida nem chega à rede', async () => {
    const spy = mockFetch(() => new Response('{}'));
    await expect(login({ email: 'nao-e-email', password: 'x' })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('login: 401 vira ApiError', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'x' } }), {
          status: 401,
        }),
    );
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(ApiError).toBeDefined();
  });

  it('logout: POST /auth/logout com corpo {} e header CSRF', async () => {
    const spy = mockFetch(
      () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
    await logout();
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/auth\/logout$/);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('bancada-web');
  });

  it('me: GET /auth/me validado com adminSchema', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ data: admin }), { status: 200 }));
    await expect(me()).resolves.toEqual(admin);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/auth\/me$/);
  });

  it('me: resposta fora do contrato é rejeitada', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 }));
    await expect(me()).rejects.toBeInstanceOf(ApiError);
  });
});
