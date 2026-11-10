// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustAdminStock, createAdminProduct, updateAdminProduct } from '../../api/adminProducts';
import { createQueryClient } from '../../app/queryClient';
import { useAdjustStock, useCreateProduct, useUpdateProduct } from './useProductMutations';

vi.mock('../../api/adminProducts', () => ({
  createAdminProduct: vi.fn(),
  updateAdminProduct: vi.fn(),
  adjustAdminStock: vi.fn(),
}));
const mockCreate = vi.mocked(createAdminProduct);
const mockUpdate = vi.mocked(updateAdminProduct);
const mockAdjust = vi.mocked(adjustAdminStock);

const ID = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
const wrap =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockAdjust.mockReset();
});

describe('useCreateProduct', () => {
  it('mutationKey ["admin","product","create"] e invalida lista da loja e do admin', async () => {
    mockCreate.mockResolvedValue({ id: ID } as never);
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateProduct(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'T',
        description: 'd',
        category: 'c',
        priceCents: 100,
        initialStock: 0,
      });
    });
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'product',
      'create',
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('erro: nada é invalidado', async () => {
    mockCreate.mockRejectedValue(new Error('x'));
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateProduct(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current
        .mutateAsync({ name: 'T', description: 'd', category: 'c', priceCents: 1, initialStock: 0 })
        .catch(() => undefined);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useUpdateProduct', () => {
  it('mutationKey ["admin","product","update"] e invalida lista, detalhe e loja', async () => {
    mockUpdate.mockResolvedValue({ id: ID } as never);
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateProduct(ID), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Novo', imageKey: null });
    });
    expect(mockUpdate).toHaveBeenCalledWith(ID, { name: 'Novo', imageKey: null });
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'product',
      'update',
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'product', ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });
});

describe('useAdjustStock', () => {
  it('mutationKey ["admin","stock","adjust"] e invalida lista, detalhe e loja', async () => {
    mockAdjust.mockResolvedValue({ product: { id: ID }, movement: { stockAfter: 8 } } as never);
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAdjustStock(ID), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync({ delta: 5, reason: 'restock' });
    });
    expect(mockAdjust).toHaveBeenCalledWith(ID, { delta: 5, reason: 'restock' });
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'stock',
      'adjust',
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'product', ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('erro (409): nada é invalidado', async () => {
    mockAdjust.mockRejectedValue(new Error('x'));
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAdjustStock(ID), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.mutateAsync({ delta: -99, reason: 'adjustment' }).catch(() => undefined);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
