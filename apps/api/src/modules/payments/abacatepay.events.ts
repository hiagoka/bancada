import type { NotificationVerdict } from './payment-webhook.service.js';
import type { Payment } from './payment-gateway.js';

// Eventos do checkout transparente que mudam (ou podem mudar) o pedido. Qualquer outro: 200 e ignora.
export const ABACATEPAY_HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'transparent.completed',
  'transparent.refunded',
  'transparent.lost',
  'transparent.disputed',
]);

// Status (da reconsulta em /transparents/check) que mostram que o Pix FOI pago.
const PAID_OR_BEYOND = new Set(['PAID', 'REFUNDED', 'UNDER_DISPUTE']);
// Status em que uma disputa perdida ainda não aparece no /check.
const LOSS_NOT_REFLECTED = new Set(['PAID', 'PENDING', 'UNDER_DISPUTE']);

// O nome do evento NÃO é confiado para mudar o pedido (quem manda é o /check), mas decide o que
// fazer quando o /check ainda não reflete o que o evento anuncia:
// - completed: o Pix foi pago. Se o /check ainda não mostra isso (atraso entre o evento e a
//   consulta) ou dá 404, responder 200 perderia o pagamento: 503 e a AbacatePay reenvia (até 7
//   vezes em cerca de 18 h; nenhum evento é gravado nessas tentativas).
// - lost: a disputa foi perdida. A documentação não diz qual status o /check mostra depois disso.
//   Com PAID, PENDING ou UNDER_DISPUTE a perda ainda não chegou: 503 e reenvio. Com qualquer outro
//   status (REFUNDED, EXPIRED, CANCELLED...) o pedido vira REFUNDED, sem devolver estoque (D13).
// - refunded e disputed: sem pressa. O /check manda (no_change se ainda não mudou).
export function judgeAbacatePayEvent(
  event: string,
): (payment: Payment | null) => NotificationVerdict {
  return (payment) => {
    switch (event) {
      case 'transparent.completed':
        return payment?.rawStatus !== undefined && PAID_OR_BEYOND.has(payment.rawStatus)
          ? { action: 'process' }
          : { action: 'retry' };
      case 'transparent.lost':
        if (payment === null) return { action: 'retry' };
        return LOSS_NOT_REFLECTED.has(payment.rawStatus ?? '')
          ? { action: 'retry' }
          : { action: 'process', target: 'REFUNDED' };
      default:
        return { action: 'process' };
    }
  };
}
