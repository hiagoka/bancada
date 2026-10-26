import type { OrderStatus } from '@bancada/contracts';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/pool.js';
import { canTransition, mpStatusToOrderStatus } from '../orders/order-status.js';
import { applyStockMovement } from '../stock/stock.repository.js';
import { GatewayError, type Payment, type PaymentGateway } from './payment-gateway.js';

export type WebhookOutcome =
  | 'applied'
  | 'no_change'
  | 'invalid_transition'
  | 'amount_mismatch'
  | 'duplicate'
  | 'order_not_found'
  // O provedor não conhece o pagamento (ex.: notificação de teste do painel do MP): nada é gravado.
  | 'payment_not_found';

export interface PaymentWebhookServiceDeps {
  pool: Pool;
  gateway: PaymentGateway;
  logger: Logger;
}

interface LockedOrder {
  id: string;
  status: OrderStatus;
  totalCents: number;
  paymentId: string | null;
}

// Mesmo formato que o Postgres aceita em colunas uuid.
const orderIdSchema = z.guid();

export class PaymentWebhookService {
  constructor(private readonly deps: PaymentWebhookServiceDeps) {}

  // Fluxo 8.2. NUNCA confia no corpo da notificação: o pagamento vem de gateway.getPayment().
  // Erro do gateway/rede propaga (5xx), sem gravar nada: o provedor reenvia e é reprocessado.
  async handlePaymentNotification(paymentId: string): Promise<WebhookOutcome> {
    const { gateway, logger } = this.deps;
    let payment: Payment;
    try {
      payment = await gateway.getPayment(paymentId);
    } catch (err) {
      // 404 do provedor: não adianta o provedor reenviar. Qualquer outro erro continua 5xx.
      if (err instanceof GatewayError && err.notFound) {
        logger.warn({ paymentId }, 'Webhook: pagamento inexistente no provedor (ignorado)');
        return 'payment_not_found';
      }
      throw err;
    }

    if (payment.status === 'unknown') {
      logger.warn(
        { paymentId: payment.id },
        'Webhook: status de pagamento desconhecido (sem mudança)',
      );
    }
    const target = payment.status === 'unknown' ? null : mpStatusToOrderStatus(payment.status);

    // Evento, pedido e estoque numa única transação: se algo falhar, nada fica gravado.
    return withTransaction(this.deps.pool, async (client) => {
      // O pedido é travado (FOR UPDATE) ANTES de inserir o evento. Na ordem inversa o INSERT
      // (FK payment_events.order_id -> orders) segura FOR KEY SHARE na linha do pedido, e duas
      // notificações simultâneas do mesmo pedido entram em deadlock ao pedir o FOR UPDATE.
      const order = await this.lockOrder(client, payment.orderId);

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO payment_events (provider, payment_id, status, order_id, amount_cents)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider, payment_id, status) DO NOTHING
         RETURNING id`,
        [
          gateway.name,
          payment.id,
          payment.rawStatus ?? payment.status,
          order?.id ?? null,
          payment.amountCents,
        ],
      );
      const eventId = inserted.rows[0]?.id;
      if (eventId === undefined) return 'duplicate';

      let outcome: WebhookOutcome;
      if (!order) {
        logger.warn({ paymentId: payment.id }, 'Webhook: pagamento de pedido inexistente');
        outcome = 'order_not_found';
      } else {
        outcome = await this.applyToOrder(client, order, payment, target);
      }

      await client.query('UPDATE payment_events SET outcome = $2 WHERE id = $1', [
        eventId,
        outcome,
      ]);
      return outcome;
    });
  }

  // external_reference vem do provedor: se não for um UUID, o pedido simplesmente não existe.
  private async lockOrder(db: Db, reference: string): Promise<LockedOrder | null> {
    if (!orderIdSchema.safeParse(reference).success) return null;
    const { rows } = await db.query<{
      id: string;
      status: OrderStatus;
      total_cents: number;
      payment_id: string | null;
    }>('SELECT id, status, total_cents, payment_id FROM orders WHERE id = $1 FOR UPDATE', [
      reference,
    ]);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          status: row.status,
          totalCents: row.total_cents,
          paymentId: row.payment_id,
        }
      : null;
  }

  private async applyToOrder(
    db: Db,
    order: LockedOrder,
    payment: Payment,
    target: OrderStatus | null,
  ): Promise<WebhookOutcome> {
    const { logger } = this.deps;
    const orderId = order.id;

    // Ordem das regras (8.2, passo 6): sem mudança -> transição proibida -> valor divergente.
    if (target === null || target === order.status) {
      // Segundo pagamento aprovado (outro payment_id) num pedido já pago: possível cobrança em dobro.
      if (target === 'PAID' && order.paymentId !== null && order.paymentId !== payment.id) {
        logger.warn(
          { orderId, paymentId: payment.id, recordedPaymentId: order.paymentId },
          'ALERTA webhook: outro pagamento aprovado para pedido já pago (possível cobrança em dobro)',
        );
      }
      return 'no_change';
    }

    if (!canTransition(order.status, target)) {
      logger.warn(
        { orderId, paymentId: payment.id, from: order.status, to: target },
        'ALERTA webhook: transição de status proibida (o pedido não foi alterado)',
      );
      return 'invalid_transition';
    }

    if (target === 'PAID' && payment.amountCents !== order.totalCents) {
      logger.warn(
        {
          orderId,
          paymentId: payment.id,
          paidCents: payment.amountCents,
          totalCents: order.totalCents,
        },
        'ALERTA webhook: valor pago diferente do total do pedido (o pedido não foi alterado)',
      );
      return 'amount_mismatch';
    }

    await db.query(
      `UPDATE orders
       SET status = $2::order_status, payment_id = $3,
           paid_at = CASE WHEN $2::order_status = 'PAID' THEN now() ELSE paid_at END,
           updated_at = now()
       WHERE id = $1`,
      [orderId, target, payment.id],
    );

    // Só o CANCELLED devolve estoque; REFUNDED é devolução de dinheiro, não de mercadoria (D13).
    if (target === 'CANCELLED') {
      // Itens em ordem de product_id: a mesma ordem dos locks da criação de pedido (D18).
      const items = await db.query<{ product_id: string; quantity: number }>(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
        [orderId],
      );
      for (const item of items.rows) {
        await applyStockMovement(db, {
          productId: item.product_id,
          delta: item.quantity,
          reason: 'order_cancelled',
          orderId,
        });
      }
    }
    return 'applied';
  }
}
