import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/http';

// Erros 4xx da API são definitivos (não adianta repetir); só falhas transitórias têm retry.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });
}

export const queryClient = createQueryClient();
