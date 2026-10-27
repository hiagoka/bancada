import type { CartLine } from '../cart/cartStore';

// Assinatura canônica do que identifica um pedido para a Idempotency-Key: itens (id + quantidade,
// ordenados por productId, como o servidor faz) e dados do cliente normalizados (nome sem espaços
// nas pontas, e-mail em minúsculo). O preço NÃO entra (o servidor ignora o do cliente).
export function orderSignature(
  lines: readonly CartLine[],
  customer: { name: string; email: string },
): string {
  const items = lines
    .map((line) => ({ id: line.product.id.toLowerCase(), q: line.quantity }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({
    items,
    name: customer.name.trim(),
    email: customer.email.trim().toLowerCase(),
  });
}
