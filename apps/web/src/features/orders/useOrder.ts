import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/http';
import { getOrder } from '../../api/orders';
import { serverNow } from '../../lib/serverClock';

export const POLL_INTERVAL_MS = 3000;
// Depois de 5 minutos de polling a tela para e oferece "Atualizar" (o pedido ainda PENDING).
export const POLL_LIMIT_MS = 5 * 60 * 1000;

// Pedido com Pix (D34): o polling segue enquanto PENDING até pix.expiresAt + 30 s (um webhook atrasado
// ainda precisa ser visto), em vez de parar aos 5 minutos. A validade é do relógio do servidor.
export const PIX_POLL_GRACE_MS = 30 * 1000;

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
      // Com Pix o prazo é a validade da cobrança (+ tolerância), não os 5 minutos.
      if (data.pix) {
        const deadline = Date.parse(data.pix.expiresAt) + PIX_POLL_GRACE_MS;
        return serverNow() <= deadline ? POLL_INTERVAL_MS : false;
      }
      return stopped ? false : POLL_INTERVAL_MS;
    },
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
