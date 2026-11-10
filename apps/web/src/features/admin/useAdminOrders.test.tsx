// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelAdminOrder, listAdminOrders } from '../../api/adminOrders';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { describeCancelError, useAdminOrders, useCancelOrder } from './useAdminOrders';

vi.mock('../../api/adminOrders', () => ({ listAdminOrders: vi.fn(), cancelAdminOrder: vi.fn() }));
const mockList = vi.mocked(listAdminOrders);
const mockCancel = vi.mocked(cancelAdminOrder);

const ID = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
const wrap =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  mockList.mockReset();
  mockCancel.mockReset();
});

describe('useAdminOrders', () => {
  it('chave ["admin","orders", filtros] e consulta com os filtros', async () => {
    mockList.mockResolvedValue({ items: [], page: 2, pageSize: 20, total: 25 });
    const client = createQueryClient();
    const filters = { status: 'PAID' as const, page: 2 };
    const { result } = renderHook(() => useAdminOrders(filters), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockList).toHaveBeenCalledWith(filters, expect.anything());
    expect(client.getQueryData(['admin', 'orders', filters])).toBeDefined();
  });
});

describe('useAdminOrders: a lista se atualiza sozinha (pedido pago pelo webhook perde o "Cancelar")', () => {
  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  const mount = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockList.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const client = createQueryClient();
    const { result } = renderHook(() => useAdminOrders({ status: 'all', page: 1 }), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockList).toHaveBeenCalledTimes(1);
  };

  it('refaz a consulta a cada 60 s', async () => {
    await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(59_000)));
    expect(mockList).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('refaz a consulta ao voltar o foco para a janela (dados com mais de 30 s)', async () => {
    await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(31_000)));
    expect(mockList).toHaveBeenCalledTimes(1);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});

describe('useCancelOrder', () => {
  it('mutationKey ["admin","order","cancel"] e invalida pedidos, produtos, detalhes e loja', async () => {
    mockCancel.mockResolvedValue({ id: ID } as never);
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelOrder(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync(ID);
    });
    expect(mockCancel).toHaveBeenCalledWith(ID);
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'order',
      'cancel',
    ]);
    for (const queryKey of [
      ['admin', 'orders'],
      ['admin', 'products'],
      ['admin', 'product'],
      ['products'],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('409 ORDER_NOT_CANCELLABLE: recarrega a lista de pedidos mesmo assim (o pedido mudou)', async () => {
    mockCancel.mockRejectedValue(new ApiError(409, 'ORDER_NOT_CANCELLABLE', 'x'));
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelOrder(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync(ID).catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'orders'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('404: recarrega a lista também', async () => {
    mockCancel.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelOrder(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync(ID).catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'orders'] });
  });

  it('erro de rede: nada é invalidado', async () => {
    mockCancel.mockRejectedValue(new NetworkError());
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelOrder(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync(ID).catch(() => undefined);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('describeCancelError', () => {
  it.each([
    [
      new ApiError(409, 'ORDER_NOT_CANCELLABLE', 'x'),
      'Este pedido não pode mais ser cancelado: ele mudou de situação. A lista foi atualizada.',
    ],
    [new ApiError(404, 'NOT_FOUND', 'x'), 'Pedido não encontrado. A lista foi atualizada.'],
    [new NetworkError(), 'A API está fora do ar. Verifique sua conexão e tente de novo.'],
    [new Error('boom'), 'Não foi possível cancelar o pedido. Tente de novo em instantes.'],
  ])('%s', (error, message) => {
    expect(describeCancelError(error)).toBe(message);
  });
});
