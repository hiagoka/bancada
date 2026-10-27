import type { OrderStatus } from '@bancada/contracts';
import { STATUS_LABEL } from './orderStatus';

// Selo de status em PT-BR. O texto é o principal; a cor só reforça.
export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <p className={`status-pill status-pill--${status.toLowerCase()}`}>
      <span className="visually-hidden">Status do pedido: </span>
      {STATUS_LABEL[status]}
    </p>
  );
}
