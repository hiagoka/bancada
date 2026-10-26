import { randomUUID } from 'node:crypto';
import { simulatePaymentInputSchema } from '@bancada/contracts';
import { Router, type Request } from 'express';
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { AppError } from '../../shared/errors.js';
import { findOrderById } from '../orders/orders.repository.js';
import type { FakePaymentGateway } from './fake.gateway.js';
import type { PaymentWebhookService } from './payment-webhook.service.js';

export interface PaymentsRouterDeps {
  pool: Pool;
  logger: Logger;
  webhookService: PaymentWebhookService;
  // Só com o gateway do Mercado Pago: sem secret a rota do webhook nem existe.
  webhookSecret?: string;
  // Só com o gateway fake: habilita /dev/payments/simulate.
  fakeGateway?: FakePaymentGateway;
}

const DATA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// type e data.id vêm da query (formato atual do Mercado Pago) ou do corpo.
function readNotification(req: Request): { type?: string; dataId?: string } {
  const body: unknown = req.body;
  const bodyRecord =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const bodyData =
    typeof bodyRecord.data === 'object' && bodyRecord.data !== null
      ? (bodyRecord.data as Record<string, unknown>)
      : {};
  const bodyId = bodyData.id;
  return {
    type: firstString(req.query.type) ?? firstString(bodyRecord.type),
    dataId:
      firstString(req.query['data.id']) ??
      (typeof bodyId === 'string' || typeof bodyId === 'number' ? String(bodyId) : undefined),
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
    router.post('/webhooks/mercadopago', async (req, res) => {
      const { type, dataId } = readNotification(req);

      // Passo 1: só notificações de pagamento interessam; o resto é confirmado e ignorado.
      if (type !== 'payment') {
        res.status(200).json({ data: { ignored: true } });
        return;
      }
      if (!dataId || !DATA_ID_PATTERN.test(dataId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos', [
          { path: 'data.id', message: 'Informe o id do pagamento (data.id)' },
        ]);
      }

      // Passo 2: assinatura do Mercado Pago, SEM janela de tempo (D6): replays são inofensivos
      // pela deduplicação. Nunca logar o secret nem o x-signature.
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.get('x-signature'),
          xRequestId: req.get('x-request-id'),
          dataId,
          secret: webhookSecret,
        });
      } catch (err) {
        if (err instanceof InvalidWebhookSignatureError) {
          logger.warn(
            { reason: err.reason, requestId: err.requestId },
            'Webhook com assinatura inválida',
          );
          throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida');
        }
        throw err;
      }

      const outcome = await webhookService.handlePaymentNotification(dataId);
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
