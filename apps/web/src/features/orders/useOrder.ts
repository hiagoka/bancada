import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/http';
import { getOrder } from '../../api/orders';
import { serverNow } from '../../lib/serverClock';

export const POLL_INTERVAL_MS = 3000;
// Depois de 5 minutos de polling a tela para e oferece "Atualizar" (o pedido ainda PENDING).
export const POLL_LIMIT_MS = 5 * 60 * 1000;

// Pedido com Pix (D34): o prazo do polling é o da cobrança, não os 5 minutos. Cronograma (relógio do
// servidor):
//   - primeiros 5 min do pedido ........................... a cada 3 s (o cliente está pagando agora)
//   - depois, até pix.expiresAt + 30 s ..................... a cada 10 s
//   - depois da tolerância, por até 10 min ................. a cada 15 s (o webhook da AbacatePay
//     pode confirmar um pagamento feito no último segundo bem depois da validade)
// Além disso o foco da aba consulta de novo (enquanto PENDING). Sem isso um pedido aberto por ~30 min
// faria ~600 consultas; assim faz ~250.
export const PIX_POLL_GRACE_MS = 30 * 1000;
export const PIX_FAST_WINDOW_MS = 5 * 60 * 1000;
export const PIX_SLOW_POLL_MS = 10 * 1000;
export const PIX_LATE_POLL_MS = 15 * 1000;
export const PIX_LATE_WINDOW_MS = 10 * 60 * 1000;

// Intervalo do polling de um pedido PENDING com Pix, ou false (sem polling).
export function pixPollInterval(
  order: { createdAt: string; pix: { expiresAt: string } },
  now: number,
): number | false {
  const deadline = Date.parse(order.pix.expiresAt) + PIX_POLL_GRACE_MS;
  if (now <= deadline) {
    return now - Date.parse(order.createdAt) < PIX_FAST_WINDOW_MS
      ? POLL_INTERVAL_MS
      : PIX_SLOW_POLL_MS;
  }
  return now <= deadline + PIX_LATE_WINDOW_MS ? PIX_LATE_POLL_MS : false;
}

export const orderQueryKey = (id: string) => ['order', id] as const;

// 4xx (404 inclusive) é definitivo: não adianta repetir. Falha de rede tenta até 2 vezes.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

// ['order', id] com polling de 3 s SÓ enquanto o status é PENDING (a função olha o dado ATUAL), sem
// polling em segundo plano e com limite de 5 min contados da montagem. O status vem sempre da API.
export function useOrder(id: string) {
  // epoch muda no "Atualizar" e reinicia a janela de 5 min.
  const [epoch, setEpoch] = useState(0);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);
  const windowKey = `${id}#${epoch}`;
  const stopped = stoppedAt === windowKey;

  useEffect(() => {
    const timer = setTimeout(() => setStoppedAt(windowKey), POLL_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [windowKey]);

  const query = useQuery({
    queryKey: orderQueryKey(id),
    queryFn: ({ signal }) => getOrder(id, signal),
    staleTime: 0, // ao abrir a página, revalida mesmo que o checkout tenha acabado de gravar o pedido
    retry: shouldRetry,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.status !== 'PENDING') return false;
      if (data.pix) return pixPollInterval({ ...data, pix: data.pix }, serverNow());
      return stopped ? false : POLL_INTERVAL_MS;
    },
    // Voltar para a aba: um pedido com Pix ainda PENDING é consultado de novo, mesmo que o polling
    // já tenha parado (o pagamento pode ter sido confirmado enquanto a aba estava em segundo plano).
    refetchOnWindowFocus: (q) => q.state.data?.status === 'PENDING' && Boolean(q.state.data.pix),
  });

  const { refetch } = query;
  const restartPolling = useCallback(() => {
    setEpoch((n) => n + 1);
    void refetch();
  }, [refetch]);

  return {
    ...query,
    // true só se parou POR LIMITE de 5 min e o pedido continua PENDING (com Pix o prazo é outro).
    pollingStopped: stopped && query.data?.status === 'PENDING' && !query.data.pix,
    restartPolling,
  };
}
