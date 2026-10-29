// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { ADMIN } from '../../test/adminHelpers';
import { useAdminMutation } from './useAdminMutation';

const wrap =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe('useAdminMutation (D30)', () => {
  it('a mutationKey SEMPRE começa por "admin"', () => {
    const client = createQueryClient();
    const { result } = renderHook(
      () => useAdminMutation({ mutationKey: ['product', 'save'], mutationFn: async () => 1 }),
      { wrapper: wrap(client) },
    );
    act(() => result.current.mutate(undefined));
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'product',
      'save',
    ]);
  });

  it('não duplica o prefixo quando a chave já começa por "admin"', () => {
    const client = createQueryClient();
    const { result } = renderHook(
      () => useAdminMutation({ mutationKey: ['admin', 'x'], mutationFn: async () => 1 }),
      { wrapper: wrap(client) },
    );
    act(() => result.current.mutate(undefined));
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual(['admin', 'x']);
  });

  it('um 401 derruba a sessão (zera ["admin","me"])', async () => {
    const client = createQueryClient();
    client.setQueryData(['admin', 'me'], ADMIN);
    const { result } = renderHook(
      () =>
        useAdminMutation({
          mutationKey: ['product', 'save'],
          mutationFn: async () => {
            throw new ApiError(401, 'UNAUTHORIZED', 'x');
          },
        }),
      { wrapper: wrap(client) },
    );
    await act(async () => {
      await result.current.mutateAsync(undefined).catch(() => undefined);
    });
    expect(client.getQueryData(['admin', 'me'])).toBeNull();
  });

  it('não repete a chamada em caso de erro (retry false)', async () => {
    const client = createQueryClient();
    let calls = 0;
    const { result } = renderHook(
      () =>
        useAdminMutation({
          mutationKey: ['product', 'save'],
          mutationFn: async () => {
            calls += 1;
            throw new Error('x');
          },
        }),
      { wrapper: wrap(client) },
    );
    await act(async () => {
      await result.current.mutateAsync(undefined).catch(() => undefined);
    });
    expect(calls).toBe(1);
  });
});
