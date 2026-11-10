import { orderSchema, publicOrderSchema, type Order, type PublicOrder } from '@bancada/contracts';
import { isCancellable } from './order-status.js';
import type { OrderWithItems } from './orders.repository.js';

const toBase = (order: OrderWithItems) => ({
  id: order.id,
  status: order.status,
  items: order.items,
  totalCents: order.totalCents,
  // checkoutUrl só enquanto o pedido está PENDING.
  checkoutUrl: order.status === 'PENDING' ? order.checkoutUrl : null,
  paidAt: order.paidAt ? order.paidAt.toISOString() : null,
  createdAt: order.createdAt.toISOString(),
});

// Pix só enquanto PENDING e só inteiro: três campos preenchidos, ou nada (nunca pela metade).
function toPix(order: OrderWithItems) {
  if (order.status !== 'PENDING') return null;
  if (order.pixCode === null || order.pixQrImage === null || order.pixExpiresAt === null) {
    return null;
  }
  return {
    brCode: order.pixCode,
    qrCodeImage: order.pixQrImage,
    expiresAt: order.pixExpiresAt.toISOString(),
  };
}

// Resposta pública: SEM dados do cliente. checkoutUrl e pix só enquanto o pedido está PENDING.
export function toPublicOrder(order: OrderWithItems): PublicOrder {
  const parsed = publicOrderSchema.safeParse({ ...toBase(order), pix: toPix(order) });
  // Dado do banco fora do contrato é bug nosso (500), não erro de validação do cliente.
  if (!parsed.success) throw new Error('Pedido fora do contrato público', { cause: parsed.error });
  return parsed.data;
}

// Visão completa, SÓ para /admin: inclui os dados do cliente e `cancellable` (calculado aqui,
// com o mesmo helper do cancelamento).
export function toAdminOrder(order: OrderWithItems, now: Date): Order {
  const parsed = orderSchema.safeParse({
    ...toBase(order),
    customer: { name: order.customerName, email: order.customerEmail },
    cancellable: isCancellable(order, now),
  });
  if (!parsed.success) throw new Error('Pedido fora do contrato de admin', { cause: parsed.error });
  return parsed.data;
}
