import type { OrderStatus } from '@bancada/contracts';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/pool.js';
import { canTransition, paymentStatusToOrderStatus } from '../orders/order-status.js';
import { applyStockMovement } from '../stock/stock.repository.js';
import { GatewayError, type Payment, type PaymentGateway } from './payment-gateway.js';

export type WebhookOutcome =
  | 'applied'
  | 'no_change'
  | 'invalid_transition'
  | 'amount_mismatch'
  | 'duplicate'
  | 'order_not_found'
  // O provedor não conhece o pagamento (ex.: notificação de teste do painel do provedor): nada é gravado.
  | 'payment_not_found';

// A notificação anuncia algo que o provedor ainda não confirma na reconsulta (ex.: "pago" com o
// status ainda pendente, ou 404 transitório). Nada foi gravado: a rota responde 503 e o provedor
// REENVIA. Não grava payment_event, então a deduplicação nunca bloqueia o reenvio.
export class NotificationNotReadyError extends Error {
  constructor(readonly paymentId: string) {
    super('O provedor ainda não confirma o que a notificação anuncia');
    this.name = 'NotificationNotReadyError';
  }
}

// Decisão específica do provedor, tomada DEPOIS da reconsulta e ANTES de gravar qualquer coisa.
// `payment` é null quando o provedor diz que a cobrança não existe (404).
export type NotificationVerdict =
  | { action: 'process'; target?: OrderStatus } // target força o status alvo (ex.: lost -> REFUNDED)
  | { action: 'retry' };

export interface NotificationOptions {
  judge?: (payment: Payment | null) => NotificationVerdict;
}

export interface PaymentWebhookServiceDeps {
  pool: Pool;
  gateway: PaymentGateway;
  logger: Logger;
}

interface OrderLockRow {
  id: string;
  status: OrderStatus;
  total_cents: number;
  payment_id: string | null;
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
  async handlePaymentNotification(
    paymentId: string,
    options: NotificationOptions = {},
  ): Promise<WebhookOutcome> {
    const { gateway, logger } = this.deps;
    const retry = (reason: string): never => {
      logger.warn({ paymentId }, `Webhook: ${reason} (503 para o provedor reenviar)`);
      throw new NotificationNotReadyError(paymentId);
    };
    let payment: Payment;
    try {
      payment = await gateway.getPayment(paymentId);
    } catch (err) {
      // 404 do provedor: por padrão não adianta reenviar. Se a notificação anuncia um pagamento
      // (o veredito do provedor pede nova tentativa), pode ser um 404 transitório: reenvia.
      if (err instanceof GatewayError && err.notFound) {
        if (options.judge?.(null).action === 'retry') retry('cobrança ainda não encontrada');
        logger.warn({ paymentId }, 'Webhook: pagamento inexistente no provedor (ignorado)');
        return 'payment_not_found';
      }
      throw err;
    }

    const verdict = options.judge?.(payment) ?? { action: 'process' as const };
    if (verdict.action === 'retry') retry('o provedor ainda não confirma o que foi anunciado');

    if (payment.status === 'unknown') {
      logger.warn(
        { paymentId: payment.id },
        'Webhook: status de pagamento desconhecido (sem mudança)',
      );
    }
    const mapped = payment.status === 'unknown' ? null : paymentStatusToOrderStatus(payment.status);
    const target = verdict.action === 'process' && verdict.target ? verdict.target : mapped;

    // Evento, pedido e estoque numa única transação: se algo falhar, nada fica gravado.
    return withTransaction(this.deps.pool, async (client) => {
      // O pedido é travado (FOR UPDATE) ANTES de inserir o evento. Na ordem inversa o INSERT
      // (FK payment_events.order_id -> orders) segura FOR KEY SHARE na linha do pedido, e duas
      // notificações simultâneas do mesmo pedido entram em deadlock ao pedir o FOR UPDATE.
      const order = await this.lockOrder(client, payment);

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

  // Trava o pedido (FOR UPDATE). Com orderId do provedor (fake e simulate) vale o id, que pode não
  // ser um UUID (então o pedido não existe); sem ele (AbacatePay) vale checkout_id + provedor (único: índice da migração 003).
  private async lockOrder(db: Db, payment: Payment): Promise<LockedOrder | null> {
    const columns = 'SELECT id, status, total_cents, payment_id FROM orders';
    let result;
    if (payment.orderId !== null) {
      if (!orderIdSchema.safeParse(payment.orderId).success) return null;
      result = await db.query<OrderLockRow>(`${columns} WHERE id = $1 FOR UPDATE`, [
        payment.orderId,
      ]);
    } else {
      result = await db.query<OrderLockRow>(
        `${columns} WHERE checkout_id = $1 AND payment_provider = $2 FOR UPDATE`,
        [payment.id, this.deps.gateway.name],
      );
    }
    const row = result.rows[0];
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

    // Sem valor informado pelo provedor (AbacatePay) não há o que conferir.
    if (
      target === 'PAID' &&
      payment.amountCents !== null &&
      payment.amountCents !== order.totalCents
    ) {
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
