import type { CreateOrderInput } from '@bancada/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createOrder } from '../../api/orders';
import { PRODUCTS_QUERY_KEY } from '../catalog/useProducts';

export const CREATE_ORDER_MUTATION_KEY = ['create-order'] as const;

export interface CreateOrderVariables {
  input: CreateOrderInput;
  idempotencyKey: string;
}

// retry: false, SEMPRE: um POST nunca é repetido automaticamente (quem decide o retry é o usuário,
// que reenvia com a MESMA Idempotency-Key). No sucesso, guarda o pedido no cache de ['order', id]
// e invalida ['products'] (o estoque mudou).
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: CREATE_ORDER_MUTATION_KEY,
    retry: false,
    mutationFn: ({ input, idempotencyKey }: CreateOrderVariables) =>
      createOrder(input, idempotencyKey),
    onSuccess: (order) => {
      queryClient.setQueryData(['order', order.id], order);
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}
