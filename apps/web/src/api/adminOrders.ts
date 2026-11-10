import {
  adminOrdersPageSchema,
  orderSchema,
  type AdminOrdersPage,
  type Order,
  type OrderStatus,
} from '@bancada/contracts';
import { request } from './http';

export interface AdminOrdersFilters {
  // 'all' = sem filtro de status.
  status: OrderStatus | 'all';
  page: number;
}

// GET /admin/orders?status=&page= (20 por página, mais recentes primeiro). É o ÚNICO lugar com dados
// do cliente; o campo `cancellable` vem calculado pelo servidor e o web nunca o recalcula.
export function listAdminOrders(
  filters: AdminOrdersFilters,
  signal?: AbortSignal,
): Promise<AdminOrdersPage> {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  params.set('page', String(filters.page));
  return request(`/admin/orders?${params.toString()}`, { schema: adminOrdersPageSchema, signal });
}

// POST /admin/orders/:id/cancel (o http.ts manda o corpo '{}' do CSRF). 404 ou 409
// ORDER_NOT_CANCELLABLE quando o pedido mudou de situação.
export function cancelAdminOrder(id: string): Promise<Order> {
  return request(`/admin/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    schema: orderSchema,
  });
}
