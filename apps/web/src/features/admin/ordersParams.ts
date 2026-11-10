import { orderStatusSchema, type OrderStatus } from '@bancada/contracts';
import type { AdminOrdersFilters } from '../../api/adminOrders';

const MAX_PAGE = 1_000_000;

// Filtro e página vêm da URL (?status=&page=). Valor inválido NUNCA chega à API: cai no padrão.
export function parseOrdersParams(params: URLSearchParams): AdminOrdersFilters {
  const status = orderStatusSchema.safeParse(params.get('status'));
  const raw = params.get('page') ?? '';
  const page = /^\d+$/.test(raw) ? Number(raw) : 1;
  return {
    status: status.success ? status.data : 'all',
    page: page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

export function ordersHref({ status, page }: AdminOrdersFilters): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status satisfies OrderStatus);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/pedidos${query ? `?${query}` : ''}`;
}
