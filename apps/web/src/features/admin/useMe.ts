import type { Admin } from '@bancada/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiError, NetworkError } from '../../api/http';
import { me } from '../../api/auth';

export const ME_QUERY_KEY = ['admin', 'me'] as const;
export const ME_STALE_TIME_MS = 60_000;

// Sessão do admin. A fonte da verdade é o cookie httpOnly: nada de token em localStorage ou
// sessionStorage (o web nunca vê o JWT). `null` = sem sessão (401 ou logout); erro = falha de rede.
export async function fetchMe(signal?: AbortSignal): Promise<Admin | null> {
  try {
    return await me(signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useMe() {
  return useQuery<Admin | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: ME_STALE_TIME_MS,
    // 401 já virou `null`; só falha de rede merece (poucas) novas tentativas.
    retry: (failureCount, error) => error instanceof NetworkError && failureCount < 1,
  });
}
