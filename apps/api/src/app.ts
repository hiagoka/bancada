import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { stdSerializers } from 'pino';
import { pinoHttp } from 'pino-http';
import { AppError } from './shared/errors.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { createProductsRouter } from './modules/products/products.routes.js';
import { FakePaymentGateway } from './modules/payments/fake.gateway.js';
import { PaymentWebhookService } from './modules/payments/payment-webhook.service.js';
import { createPaymentsRouter } from './modules/payments/payments.routes.js';
import type { PaymentGateway } from './modules/payments/payment-gateway.js';
import type { StorageService } from './modules/storage/storage.service.js';
import { errorHandler, notFoundHandler } from './shared/http.js';

function omitKeys<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key)),
  ) as Partial<T>;
}

export interface AppDeps {
  pool: Pool;
  logger: Logger;
  webUrl: string;
  storage: StorageService;
  gateway: PaymentGateway;
  // Segredo do webhook do Mercado Pago; sem ele a rota /webhooks/mercadopago não é montada.
  webhookSecret?: string;
  now?: () => Date;
}

export function createApp({
  pool,
  logger,
  webUrl,
  storage,
  gateway,
  webhookSecret,
  now,
}: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      // Nunca logar cookie, token, credenciais nem a assinatura do webhook (seção 12).
      serializers: {
        req: (req: Parameters<typeof stdSerializers.req>[0]) => {
          const { headers, ...rest } = stdSerializers.req(req);
          const safeHeaders = omitKeys(headers, ['cookie', 'authorization', 'x-signature']);
          return { ...rest, headers: safeHeaders };
        },
        res: (res: Parameters<typeof stdSerializers.res>[0]) => {
          const { headers, ...rest } = stdSerializers.res(res);
          const safeHeaders = omitKeys(headers ?? {}, ['set-cookie']);
          return { ...rest, headers: safeHeaders };
        },
      },
    }),
  );
  app.use(
    cors({
      origin: new URL(webUrl).origin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Requested-With'],
    }),
  );
  app.use(express.json());

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      req.log.error({ err }, 'Health check: banco de dados indisponível');
      throw new AppError(500, 'INTERNAL_ERROR', 'Banco de dados indisponível');
    }
    res.json({ data: { status: 'ok' } });
  });

  app.use(createProductsRouter({ pool, storage }));
  app.use(createOrdersRouter({ ordersService: new OrdersService({ pool, gateway, logger, now }) }));

  app.use(
    createPaymentsRouter({
      pool,
      logger,
      webhookService: new PaymentWebhookService({ pool, gateway, logger }),
      webhookSecret,
      fakeGateway: gateway instanceof FakePaymentGateway ? gateway : undefined,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
