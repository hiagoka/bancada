import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { stdSerializers } from 'pino';
import { pinoHttp } from 'pino-http';
import { AppError } from './shared/errors.js';
import { createAdminOrdersRouter } from './modules/admin/admin-orders.routes.js';
import { AdminOrdersService } from './modules/admin/admin-orders.service.js';
import { createAdminProductsRouter } from './modules/admin/admin-products.routes.js';
import { AdminProductsService } from './modules/admin/admin-products.service.js';
import { createAuthRouter, type LoginRateLimit } from './modules/auth/auth.routes.js';
import { AuthService, BCRYPT_COST_PRODUCTION } from './modules/auth/auth.service.js';
import { createRequireAdmin } from './modules/auth/require-admin.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { createProductsRouter } from './modules/products/products.routes.js';
import { FakePaymentGateway } from './modules/payments/fake.gateway.js';
import { PaymentWebhookService } from './modules/payments/payment-webhook.service.js';
import { createPaymentsRouter } from './modules/payments/payments.routes.js';
import type { PaymentGateway } from './modules/payments/payment-gateway.js';
import type { StorageService } from './modules/storage/storage.service.js';
import { requireCsrfHeader } from './shared/csrf.js';
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
  jwtSecret: string;
  cookieSameSite: 'lax' | 'none';
  // Cookie Secure (produção). Com cookieSameSite='none' é sempre Secure.
  secureCookies?: boolean;
  // Custo do bcrypt (padrão 12; os testes usam 4).
  bcryptCost?: number;
  loginRateLimit?: LoginRateLimit;
  // Valor de app.set('trust proxy'): necessário atrás de proxy para o rate limit ver o IP real.
  trustProxy?: boolean | number | string;
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
  jwtSecret,
  cookieSameSite,
  secureCookies = false,
  bcryptCost = BCRYPT_COST_PRODUCTION,
  loginRateLimit,
  trustProxy,
}: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
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
  // CSRF (D15) ANTES do parser: um POST sem os cabeçalhos é recusado mesmo com JSON malformado.
  app.use(['/auth', '/admin'], (_req, res, next) => {
    // Sessão e dados de clientes nunca ficam em cache de navegador ou proxy.
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(['/auth', '/admin'], requireCsrfHeader);
  app.use(express.json());
  app.use(cookieParser());

  const authService = new AuthService({ pool, jwtSecret, bcryptCost });
  const requireAdmin = createRequireAdmin(authService);

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      req.log.error({ err }, 'Health check: banco de dados indisponível');
      throw new AppError(500, 'INTERNAL_ERROR', 'Banco de dados indisponível');
    }
    res.json({ data: { status: 'ok' } });
  });

  app.use(
    '/auth',
    createAuthRouter({
      authService,
      requireAdmin,
      sameSite: cookieSameSite,
      secure: secureCookies,
      logger,
      loginRateLimit,
    }),
  );
  // Tudo em /admin exige admin logado. A T11 pendura as rotas aqui, depois deste middleware.
  app.use('/admin', requireAdmin);
  app.use(
    '/admin',
    createAdminProductsRouter({ service: new AdminProductsService({ pool, storage }) }),
  );
  app.use('/admin', createAdminOrdersRouter({ service: new AdminOrdersService({ pool, now }) }));

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
