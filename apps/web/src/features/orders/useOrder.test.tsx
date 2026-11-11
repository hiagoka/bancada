// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrder } from '../../api/orders';
import { ApiError, NetworkError } from '../../api/http';
import { makeOrder, ORDER_ID } from '../../test/orderFixtures';
import { recordServerDate, resetServerClock } from '../../lib/serverClock';
import {
  PIX_FAST_WINDOW_MS,
  PIX_LATE_POLL_MS,
  PIX_LATE_WINDOW_MS,
  PIX_POLL_GRACE_MS,
  PIX_SLOW_POLL_MS,
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
  useOrder,
} from './useOrder';

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
  resetServerClock();
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

describe('useOrder: polling de pedidos com Pix (D34)', () => {
  // createdAt = agora (relógio falso), validade em `seconds`.
  const pixOrder = (seconds: number, overrides: Partial<Parameters<typeof makeOrder>[0]> = {}) =>
    makeOrder({
      createdAt: new Date().toISOString(),
      pix: {
        brCode: '00020101021226950014br.gov.bcb.pix0136teste',
        qrCodeImage: 'data:image/png;base64,iVBORw0KGgo=',
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
      },
      ...overrides,
    });
  const callsDuring = async (ms: number) => {
    const before = mockGetOrder.mock.calls.length;
    await advance(ms);
    return mockGetOrder.mock.calls.length - before;
  };

  it('constantes do cronograma', () => {
    expect(PIX_POLL_GRACE_MS).toBe(30_000);
    expect(PIX_FAST_WINDOW_MS).toBe(5 * 60_000);
    expect(PIX_SLOW_POLL_MS).toBe(10_000);
    expect(PIX_LATE_POLL_MS).toBe(15_000);
    expect(PIX_LATE_WINDOW_MS).toBe(10 * 60_000);
  });

  it('nos primeiros 5 minutos do pedido: a cada 3 s', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(30 * 60));
    mount();
    await advance(0);
    expect(await callsDuring(30_000)).toBe(10);
    await advance(4 * 60_000 - 30_000 - 10_000); // perto dos 4 min
    expect(await callsDuring(30_000)).toBe(10);
  });

  it('depois de 5 minutos, até a validade + 30 s: a cada 10 s (não mais a cada 3 s)', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(30 * 60));
    const { result } = mount();
    await advance(0);
    await advance(PIX_FAST_WINDOW_MS + 5_000);
    expect(await callsDuring(60_000)).toBe(6);
    expect(result.current.pollingStopped).toBe(false); // não é parada "por limite"
  });

  it('um pedido de ~30 min faz bem menos que 600 consultas (o custo que a revisão apontou)', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(30 * 60));
    mount();
    await advance(0);
    await advance(30 * 60_000);
    // 5 min a cada 3 s (100) + 25 min a cada 10 s (150) = ~250
    expect(mockGetOrder.mock.calls.length).toBeLessThan(300);
    expect(mockGetOrder.mock.calls.length).toBeGreaterThan(200);
  });

  it('sem Pix (modo fake) o limite de 5 minutos continua valendo', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ pix: null }));
    const { result } = mount();
    await advance(0);
    await advance(POLL_LIMIT_MS + 1000);
    const calls = mockGetOrder.mock.calls.length;
    await advance(30_000);
    expect(mockGetOrder).toHaveBeenCalledTimes(calls);
    expect(result.current.pollingStopped).toBe(true);
  });

  it('DEPOIS da validade + 30 s o polling continua, mais devagar (15 s), por até 10 minutos', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(60));
    mount();
    await advance(0);
    await advance(60_000 + PIX_POLL_GRACE_MS + 1000); // passou a tolerância
    expect(await callsDuring(60_000)).toBe(4); // a cada 15 s
    await advance(8 * 60_000); // ~9,5 min depois da tolerância: ainda dentro dos 10 min
    expect(await callsDuring(30_000)).toBe(2);
  });

  it('passados 10 minutos depois da tolerância o polling para de vez', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(60));
    mount();
    await advance(0);
    await advance(60_000 + PIX_POLL_GRACE_MS + PIX_LATE_WINDOW_MS + 20_000);
    expect(await callsDuring(5 * 60_000)).toBe(0);
  });

  it('um pagamento que o webhook confirma MINUTOS depois de expirar é visto (o pedido vira PAID)', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(10));
    const { result } = mount();
    await advance(0);
    await advance(4 * 60_000); // 4 min depois da validade
    expect(result.current.data?.status).toBe('PENDING');
    mockGetOrder.mockResolvedValue(
      makeOrder({ status: 'PAID', pix: null, paidAt: new Date().toISOString() }),
    );
    await advance(PIX_LATE_POLL_MS + 100);
    expect(result.current.data?.status).toBe('PAID');
    expect(await callsDuring(5 * 60_000)).toBe(0); // e para
  });

  it('Pix já vencido há muito ao abrir a página: consulta e segue devagar (15 s)', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(-120));
    mount();
    await advance(0);
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
    expect(await callsDuring(30_000)).toBe(2);
  });

  it('o prazo usa o relógio do SERVIDOR (aparelho 10 min atrasado)', async () => {
    // pelo relógio do aparelho o Pix ainda valeria ~9 min; pelo servidor venceu há 1 min
    const serverNow = Date.now() + 10 * 60_000;
    recordServerDate(new Date(serverNow).toUTCString());
    mockGetOrder.mockResolvedValue(
      makeOrder({
        createdAt: new Date(serverNow - 31 * 60_000).toISOString(),
        pix: {
          brCode: 'x',
          qrCodeImage: 'data:image/png;base64,AAAA',
          expiresAt: new Date(serverNow - 60_000).toISOString(),
        },
      }),
    );
    mount();
    await advance(0);
    expect(await callsDuring(30_000)).toBe(2); // ritmo atrasado (15 s), não o de 3 s
  });

  it('ao voltar o foco para a aba, consulta de novo (pedido com Pix ainda PENDING)', async () => {
    mockGetOrder.mockResolvedValue(pixOrder(60));
    mount();
    await advance(0);
    await advance(60_000 + PIX_POLL_GRACE_MS + PIX_LATE_WINDOW_MS + 60_000); // polling já parou
    const calls = mockGetOrder.mock.calls.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mockGetOrder.mock.calls.length).toBe(calls + 1);
    focusManager.setFocused(undefined);
  });

  it('o foco da aba NÃO consulta pedidos que já não estão PENDING', async () => {
    mockGetOrder.mockResolvedValue(makeOrder({ status: 'PAID', pix: null }));
    mount();
    await advance(0);
    const calls = mockGetOrder.mock.calls.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mockGetOrder.mock.calls.length).toBe(calls);
    focusManager.setFocused(undefined);
  });

  it.each(['PAID', 'CANCELLED', 'REFUNDED'] as const)(
    'com Pix, %s também para o polling',
    async (final) => {
      mockGetOrder
        .mockResolvedValueOnce(pixOrder(1800))
        .mockResolvedValue(makeOrder({ status: final }));
      mount();
      await advance(0);
      await advance(3000);
      await advance(50);
      const calls = mockGetOrder.mock.calls.length;
      await advance(60_000);
      expect(mockGetOrder).toHaveBeenCalledTimes(calls);
    },
  );
});
