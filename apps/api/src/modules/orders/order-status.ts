import type { OrderStatus } from '@bancada/contracts';

// Status do Mercado Pago -> status alvo do pedido (ARCHITECTURE.md, 8.3).
// pending, in_process, authorized e rejected não mudam o pedido (cartão recusado permite nova tentativa).
const MP_TARGETS: Record<string, OrderStatus> = {
  approved: 'PAID',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  charged_back: 'REFUNDED',
};

export function mpStatusToOrderStatus(mpStatus: string): OrderStatus | null {
  return Object.hasOwn(MP_TARGETS, mpStatus) ? MP_TARGETS[mpStatus]! : null;
}

// Transições permitidas. Nenhuma outra. O cancelamento manual do admin (8.8) é a única
// outra forma de levar PENDING a CANCELLED.
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
