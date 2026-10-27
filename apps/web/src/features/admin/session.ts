import type { QueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from './useMe';

// Sem sessão: some TUDO do admin que estava em cache e marca `me` como null (sem refazer a consulta
// nem deixar dados do admin anterior à vista).
export function clearAdminSession(client: QueryClient): void {
  client.removeQueries({ queryKey: ['admin'] });
  client.setQueryData(ME_QUERY_KEY, null);
}
