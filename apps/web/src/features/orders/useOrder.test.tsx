// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrder } from '../../api/orders';
import { ApiError, NetworkError } from '../../api/http';
import { makeOrder, ORDER_ID } from '../../test/orderFixtures';
import { POLL_INTERVAL_MS, POLL_LIMIT_MS, useOrder } from './useOrder';

vi.mock('../../api/orders', () => ({ getOrder: vi.fn() }));
const mockGetOrder = vi.mocked(getOrder);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  mockGetOrder.mockReset();
  client = new QueryClient();
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const mount = () => renderHook(() => useOrder(ORDER_ID), { wrapper });

describe('useOrder: polling', () => {
  it('constantes: 3 s de intervalo e 5 min de limite', () => {
    expect(POLL_INTERVAL_MS).toBe(3000);
    expect(POLL_LIMIT_MS).toBe(5 * 60 * 1000);
  });

  it('usa a chave [order, id]', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    mount();
    await advance(0);
    expect(client.getQueryData(['order', ORDER_ID])).toMatchObject({ id: ORDER_ID });
  });

  it('faz polling a cada 3 s enquanto o pedido está PENDING', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    mount();
    await advance(0);
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(mockGetOrder).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(mockGetOrder).toHaveBeenCalledTimes(3);
    await advance(2900); // antes do próximo tick: nada
    expect(mockGetOrder).toHaveBeenCalledTimes(3);
  });

  it.each(['PAID', 'CANCELLED', 'REFUNDED'] as const)(
    'para de consultar quando o status vira %s',
    async (final) => {
      mockGetOrder
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ status: final }));
      const { result } = mount();
      await advance(0);
      await advance(3000);
      await advance(3000); // este tick traz o status final
      await advance(50); // deixa a notificação do React Query chegar ao componente
      expect(result.current.data?.status).toBe(final);
      const calls = mockGetOrder.mock.calls.length;
      expect(calls).toBe(3);
      await advance(60_000);
      expect(mockGetOrder).toHaveBeenCalledTimes(calls); // nunca mais
      expect(result.current.pollingStopped).toBe(false); // parou porque acabou, não por limite
    },
  );

  it('pedido que já nasce PAID não faz polling nenhum', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID' }));
    mount();
    await advance(0);
    await advance(30_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('para depois de 5 minutos de polling e sinaliza pollingStopped', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    const { result } = mount();
    await advance(0);
    expect(result.current.pollingStopped).toBe(false);
    await advance(POLL_LIMIT_MS - 1000);
    expect(result.current.pollingStopped).toBe(false);
    await advance(1000);
    expect(result.current.pollingStopped).toBe(true);
    const calls = mockGetOrder.mock.calls.length;
    expect(calls).toBeGreaterThan(90);
    expect(calls).toBeLessThanOrEqual(102);
    await advance(60_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(calls); // parou de vez
  });

  it('"restartPolling" (botão Atualizar) busca de novo e reinicia a janela de 5 min', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    const { result } = mount();
    await advance(POLL_LIMIT_MS + 1000);
    expect(result.current.pollingStopped).toBe(true);
    const before = mockGetOrder.mock.calls.length;

    await act(async () => {
      result.current.restartPolling();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetOrder.mock.calls.length).toBe(before + 1); // refetch imediato
    expect(result.current.pollingStopped).toBe(false);
    await advance(3000);
    expect(mockGetOrder.mock.calls.length).toBe(before + 2); // voltou a consultar
  });

  it('não faz polling em segundo plano (refetchIntervalInBackground = false)', async () => {
    mockGetOrder.mockResolvedValue(makeOrder());
    mount();
    await advance(0);
    const observer = client.getQueryCache().find({ queryKey: ['order', ORDER_ID] })?.observers[0];
    expect(observer?.options.refetchIntervalInBackground).toBe(false);
  });
});

describe('useOrder: erros', () => {
  it('404 NÃO tenta de novo e não faz polling', async () => {
    mockGetOrder.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado'));
    const { result } = mount();
    await advance(0);
    await advance(30_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it('outros 4xx também não repetem', async () => {
    mockGetOrder.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'x'));
    mount();
    await advance(30_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('erro de rede tenta de novo (até 2 vezes) antes de desistir', async () => {
    mockGetOrder.mockRejectedValue(new NetworkError());
    const { result } = mount();
    await advance(30_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeInstanceOf(NetworkError);
  });

  it('um erro depois de dados já carregados não derruba a tela (mantém os dados)', async () => {
    mockGetOrder
      .mockResolvedValueOnce(makeOrder())
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue(makeOrder({ status: 'PAID' }));
    const { result } = mount();
    await advance(0);
    await advance(3000);
    expect(result.current.data?.status).toBe('PENDING'); // dado antigo continua
    await advance(10_000);
    expect(result.current.data?.status).toBe('PAID');
  });
});
