import { publicOrderSchema, type CreateOrderInput, type PublicOrder } from '@bancada/contracts';
import { request } from './http';

// POST /orders. O corpo é montado campo a campo: SÓ customer e items (productId, quantity), nunca
// preço (o servidor usa o do banco). 201 (criado) e 200 (replay da mesma chave) são sucesso e
// iguais para o web: o pedido existe, com ou sem checkoutUrl.
export function createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<PublicOrder> {
  return request('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      customer: { name: input.customer.name, email: input.customer.email },
      items: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    },
    schema: publicOrderSchema,
  });
}

// GET /orders/:id (público: sem dados do cliente). O id é codificado na URL.
export function getOrder(id: string, signal?: AbortSignal): Promise<PublicOrder> {
  return request(`/orders/${encodeURIComponent(id)}`, { schema: publicOrderSchema, signal });
}
