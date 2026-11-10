import { randomUUID } from 'node:crypto';
import { simulatePaymentInputSchema } from '@bancada/contracts';
import { Router } from 'express';
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
  // Só com o gateway fake: habilita /dev/payments/simulate.
  fakeGateway?: FakePaymentGateway;
}

export function createPaymentsRouter({
  pool,
  webhookService,
  fakeGateway,
}: PaymentsRouterDeps): Router {
  const router = Router();

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
