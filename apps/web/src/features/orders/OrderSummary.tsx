import type { PublicOrder } from '@bancada/contracts';
import { formatPrice } from '../../lib/format';

// Itens e total do pedido (público: sem dados do cliente). Preços sempre via formatPrice.
export function OrderSummary({ order }: { order: Pick<PublicOrder, 'items' | 'totalCents'> }) {
  return (
    <section className="order-summary" aria-labelledby="order-items-title">
      <h2 id="order-items-title">Itens</h2>
      <ul className="order-items">
        {order.items.map((item) => (
          <li key={item.productId}>
            <span className="order-items__name">{item.productName}</span>
            <span className="mono order-items__qty">
              {item.quantity} × {formatPrice(item.unitPriceCents)}
            </span>
            <span className="price order-items__subtotal">
              {formatPrice(item.unitPriceCents * item.quantity)}
            </span>
          </li>
        ))}
      </ul>
      <p className="order-total">
        <span>Total</span>
        <span className="price">{formatPrice(order.totalCents)}</span>
      </p>
    </section>
  );
}
