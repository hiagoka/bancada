import { randomUUID } from 'node:crypto';
import { simulatePaymentInputSchema } from '@bancada/contracts';
import { Router } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { AppError } from '../../shared/errors.js';
import { findOrderById } from '../orders/orders.repository.js';
import { verifyAbacatePayWebhook } from './abacatepay.signature.js';
import type { FakePaymentGateway } from './fake.gateway.js';
import type { PaymentWebhookService } from './payment-webhook.service.js';

export interface PaymentsRouterDeps {
  pool: Pool;
  logger: Logger;
  webhookService: PaymentWebhookService;
  // Segredo do webhook da AbacatePay (header X-Webhook-Secret): sem ele a rota nem existe.
  webhookSecret?: string;
  // Só com o gateway fake: habilita /dev/payments/simulate.
  fakeGateway?: FakePaymentGateway;
}

// Eventos do checkout transparente que mudam (ou podem mudar) o pedido. Qualquer outro: 200 e ignora.
const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'transparent.completed',
  'transparent.refunded',
  'transparent.lost',
  'transparent.disputed',
]);
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Lê só o que importa, sem schema rígido (a AbacatePay pode acrescentar campos): o nome do evento e
// o id da cobrança em data.transparent.id. Nada além disso do corpo é usado nem logado.
function readEvent(raw: Buffer): { event: string; paymentId: string | null } | null {
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as { event?: unknown; data?: unknown };
  if (typeof record.event !== 'string') return null;
  const data = record.data;
  const transparent =
    typeof data === 'object' && data !== null
      ? (data as { transparent?: unknown }).transparent
      : null;
  const id =
    typeof transparent === 'object' && transparent !== null
      ? (transparent as { id?: unknown }).id
      : null;
  return {
    event: record.event,
    paymentId: typeof id === 'string' && PAYMENT_ID_PATTERN.test(id) ? id : null,
  };
}

export function createPaymentsRouter({
  pool,
  logger,
  webhookService,
  webhookSecret,
  fakeGateway,
}: PaymentsRouterDeps): Router {
  const router = Router();

  if (webhookSecret) {
    // O corpo chega CRU (express.raw montado antes do parser de JSON em app.ts): a assinatura é sobre
    // os bytes exatos recebidos.
    router.post('/webhooks/abacatepay', async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      // 1 e 2: secret (prova a origem) e assinatura HMAC (prova que o corpo está intacto), ambos em
      // tempo constante. Falhou: 401 e nada é lido nem processado. Nunca logar o secret nem a
      // assinatura recebidos (a AbacatePay não reenvia 401).
      const authentic = verifyAbacatePayWebhook({
        rawBody,
        secretHeader: req.get('x-webhook-secret'),
        signatureHeader: req.get('x-webhook-signature'),
        expectedSecret: webhookSecret,
      });
      if (!authentic) {
        logger.warn({ ip: req.ip }, 'Webhook da AbacatePay com assinatura ou secret inválido');
        throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida');
      }

      // 3: JSON (já autenticado). Só os eventos de pagamento interessam.
      let notification: ReturnType<typeof readEvent>;
      try {
        notification = readEvent(rawBody);
      } catch {
        throw new AppError(400, 'INVALID_JSON', 'JSON inválido');
      }
      if (!notification || !HANDLED_EVENTS.has(notification.event) || !notification.paymentId) {
        res.status(200).json({ data: { ignored: true } });
        return;
      }

      // 4 a 6 (no serviço): a cobrança é reconsultada em /transparents/check (o status do CORPO
      // nunca é usado), o pedido é achado por orders.checkout_id e vale o fluxo 8.2 (lock do pedido
      // antes do payment_event, deduplicação, regras, estoque). Erro do provedor: 5xx, e a AbacatePay reenvia.
      const outcome = await webhookService.handlePaymentNotification(notification.paymentId);
      res.status(200).json({ data: { outcome } });
    });
  }

  if (fakeGateway) {
    // Só existe com PAYMENT_PROVIDER=fake: registra o pagamento no gateway fake e chama o MESMO
    // handlePaymentNotification do webhook real (sem assinatura).
    router.post('/dev/payments/simulate', async (req, res) => {
      const input = simulatePaymentInputSchema.parse(req.body);
      const order = await findOrderById(pool, input.orderId);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Pedido não encontrado');

      const paymentId = input.paymentId ?? `fake-pay-${randomUUID()}`;
      fakeGateway.registerPayment({
        id: paymentId,
        status: input.status,
        orderId: order.id,
        amountCents: input.amountCents ?? order.totalCents,
      });
      const outcome = await webhookService.handlePaymentNotification(paymentId);
      res.status(200).json({ data: { outcome } });
    });
  }

  return router;
}
