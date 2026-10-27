import { z } from 'zod';
import { ApiError, NetworkError } from '../../api/http';
import type { CartLine } from '../cart/cartStore';

export interface StockShortage {
  productId: string;
  name: string;
  requested: number;
  available: number;
}

export type CheckoutFailure =
  | { kind: 'out_of_stock'; items: StockShortage[] }
  | { kind: 'unavailable'; items: { productId: string; name: string }[] }
  | { kind: 'checkout_unavailable'; expired: boolean }
  | { kind: 'reused' }
  // O servidor devolveu um pedido que já foi encerrado (replay de chave antiga: CANCELLED/REFUNDED).
  | { kind: 'closed' }
  | { kind: 'validation'; messages: string[] }
  | { kind: 'network' }
  | { kind: 'generic' };

const outOfStockDetails = z.array(
  z.object({ productId: z.string(), requested: z.number(), available: z.number() }),
);
const unavailableDetails = z.array(z.object({ productId: z.string() }));
const checkoutDetails = z.object({ orderId: z.string().optional(), reason: z.string().optional() });
const validationDetails = z.array(z.object({ message: z.string() }));

// Traduz o erro da API para o que a tela precisa mostrar. Os nomes vêm do carrinho (a API só
// devolve ids). Nunca lança: o que não for reconhecido vira 'generic'.
export function describeCheckoutError(error: unknown, lines: readonly CartLine[]): CheckoutFailure {
  if (error instanceof NetworkError) return { kind: 'network' };
  if (!(error instanceof ApiError)) return { kind: 'generic' };

  const nameOf = (productId: string, fallback: string): string =>
    lines.find((line) => line.product.id === productId)?.product.name ?? fallback;

  switch (error.code) {
    case 'OUT_OF_STOCK': {
      const details = outOfStockDetails.safeParse(error.details);
      return {
        kind: 'out_of_stock',
        items: details.success
          ? details.data.map((d) => ({ ...d, name: nameOf(d.productId, 'Produto') }))
          : [],
      };
    }
    case 'PRODUCT_UNAVAILABLE': {
      const details = unavailableDetails.safeParse(error.details);
      return {
        kind: 'unavailable',
        items: details.success
          ? details.data.map((d) => ({
              productId: d.productId,
              name: nameOf(d.productId, 'Produto indisponível'),
            }))
          : [],
      };
    }
    case 'CHECKOUT_UNAVAILABLE': {
      const details = checkoutDetails.safeParse(error.details);
      return {
        kind: 'checkout_unavailable',
        expired: details.success && details.data.reason === 'expired',
      };
    }
    case 'IDEMPOTENCY_KEY_REUSED':
      return { kind: 'reused' };
    case 'VALIDATION_ERROR': {
      const details = validationDetails.safeParse(error.details);
      const messages = details.success ? details.data.map((d) => d.message) : [];
      return { kind: 'validation', messages: messages.length > 0 ? messages : [error.message] };
    }
    default:
      return { kind: 'generic' };
  }
}
