import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/http';
import { ME_QUERY_KEY } from '../features/admin/useMe';

// Erros 4xx da API são definitivos (não adianta repetir); só falhas transitórias têm retry.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

const isAdminKey = (key: readonly unknown[] | undefined): boolean => key?.[0] === 'admin';
const isLoginKey = (key: readonly unknown[] | undefined): boolean =>
  key?.[0] === 'admin' && key[1] === 'login';

export function createQueryClient(): QueryClient {
  // Sessão expirada no meio do uso: 401 de qualquer chave 'admin' (menos o próprio login, onde 401
  // é "senha errada") zera ['admin','me']. O RequireAdmin então redireciona ao login guardando o next.
  const onAuthError = (error: unknown, key: readonly unknown[] | undefined): void => {
    if (!(error instanceof ApiError) || error.status !== 401) return;
    if (!isAdminKey(key) || isLoginKey(key)) return;
    client.setQueryData(ME_QUERY_KEY, null);
  };

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => onAuthError(error, query.queryKey),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        onAuthError(error, mutation.options.mutationKey),
    }),
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });
  return client;
}

export const queryClient = createQueryClient();
