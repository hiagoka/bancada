import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/http';
import { createQueryClient } from './queryClient';

const admin = { id: '6ba7b810-9dad-41d1-80b5-00c04fd430c8', email: 'a@b.co', name: 'Ana' };
let client: QueryClient;
afterEach(() => client.clear());

const fail = async (key: readonly unknown[], error: unknown) => {
  await client
    .fetchQuery({
      queryKey: key,
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => undefined);
};

describe('401 global (sessão expirada)', () => {
  it('401 em query ["admin", ...] zera ["admin","me"] para o RequireAdmin redirecionar', async () => {
    client = createQueryClient();
    client.setQueryData(['admin', 'me'], admin);
    await fail(['admin', 'products', {}], new ApiError(401, 'UNAUTHORIZED', 'x'));
    expect(client.getQueryData(['admin', 'me'])).toBeNull();
  });

  it('401 em mutation ["admin", ...] também', async () => {
    client = createQueryClient();
    client.setQueryData(['admin', 'me'], admin);
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['admin', 'product', 'save'],
        mutationFn: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'x')),
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryData(['admin', 'me'])).toBeNull();
  });

  it('401 no LOGIN (mutation ["admin","login"]) não mexe na sessão', async () => {
    client = createQueryClient();
    client.setQueryData(['admin', 'me'], admin);
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ['admin', 'login'],
        mutationFn: () => Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'x')),
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryData(['admin', 'me'])).toEqual(admin);
  });

  it('401 em chave pública (["order", id]) não mexe na sessão', async () => {
    client = createQueryClient();
    client.setQueryData(['admin', 'me'], admin);
    await fail(['order', 'x'], new ApiError(401, 'UNAUTHORIZED', 'x'));
    expect(client.getQueryData(['admin', 'me'])).toEqual(admin);
  });

  it.each([
    new ApiError(403, 'CSRF_REJECTED', 'x'),
    new ApiError(500, 'INTERNAL_ERROR', 'x'),
    new NetworkError(),
  ])('só o 401 derruba a sessão (%s)', async (error) => {
    client = createQueryClient();
    client.setQueryData(['admin', 'me'], admin);
    await fail(['admin', 'orders', {}], error);
    expect(client.getQueryData(['admin', 'me'])).toEqual(admin);
  });
});
