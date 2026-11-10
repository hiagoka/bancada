import type { Order } from '@bancada/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelAdminOrder, listAdminOrders, type AdminOrdersFilters } from '../../api/adminOrders';
import { ApiError, NetworkError } from '../../api/http';
import { PRODUCTS_QUERY_KEY } from '../catalog/useProducts';
import { useAdminMutation } from './useAdminMutation';

export const ADMIN_ORDERS_KEY = ['admin', 'orders'] as const;

// Chave do ARCHITECTURE.md (seção 9): ['admin','orders', filtros].
export function useAdminOrders(filters: AdminOrdersFilters) {
  return useQuery({
    queryKey: [...ADMIN_ORDERS_KEY, filters],
    queryFn: ({ signal }) => listAdminOrders(filters, signal),
    placeholderData: keepPreviousData, // trocar de página não esvazia a tabela
  });
}

// Cancelar devolve o estoque (D14): atualiza pedidos, produtos (lista e detalhes) e a loja.
// Em 404 e 409 o pedido mudou por fora, então a lista de pedidos é recarregada mesmo assim.
export function useCancelOrder() {
  const client = useQueryClient();
  return useAdminMutation<Order, Error, string>({
    mutationKey: ['order', 'cancel'],
    mutationFn: (id) => cancelAdminOrder(id),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY }),
        client.invalidateQueries({ queryKey: ['admin', 'products'] }),
        client.invalidateQueries({ queryKey: ['admin', 'product'] }),
        client.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY }),
      ]),
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void client.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY });
      }
    },
  });
}

export function describeCancelError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'ORDER_NOT_CANCELLABLE') {
      return 'Este pedido não pode mais ser cancelado: ele mudou de situação. A lista foi atualizada.';
    }
    if (error.status === 404) return 'Pedido não encontrado. A lista foi atualizada.';
  }
  if (error instanceof NetworkError) {
    return 'A API está fora do ar. Verifique sua conexão e tente de novo.';
  }
  return 'Não foi possível cancelar o pedido. Tente de novo em instantes.';
}
