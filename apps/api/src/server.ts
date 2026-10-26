import pino from 'pino';
import { createApp } from './app.js';
import { EnvError, loadEnv, type Env } from './config/env.js';
import { createPool } from './db/pool.js';
import { FakePaymentGateway } from './modules/payments/fake.gateway.js';
import { createMercadoPagoGateway } from './modules/payments/mercadopago.gateway.js';
import { PublicUrlStorageService } from './modules/storage/public-url.storage.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const env = readEnvOrExit();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const pool = createPool(env.DATABASE_URL);
pool.on('error', (err) => logger.error({ err }, 'Erro em conexão ociosa do pool'));

const gateway =
  env.PAYMENT_PROVIDER === 'mercadopago'
    ? createMercadoPagoGateway({
        accessToken: env.MP_ACCESS_TOKEN!,
        webUrl: env.WEB_URL,
        apiPublicUrl: env.API_PUBLIC_URL,
      })
    : new FakePaymentGateway({ webUrl: env.WEB_URL });

// Padrão = MinIO local (ver .env.example). A T12 troca por um S3StorageService completo.
const storage = new PublicUrlStorageService(env.S3_PUBLIC_URL ?? 'http://localhost:9000/bancada');
if (env.PAYMENT_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
  logger.warn(
    'PAYMENT_PROVIDER=fake em produção: pagamentos simulados e /dev/payments/simulate expostos',
  );
}

if (env.NODE_ENV === 'production' && env.TRUST_PROXY === false) {
  logger.warn(
    'TRUST_PROXY=false em produção: atrás de proxy/load balancer todos os clientes compartilham o IP do proxy no rate limit do login (defina TRUST_PROXY=1)',
  );
}

const app = createApp({
  pool,
  logger,
  webUrl: env.WEB_URL,
  storage,
  gateway,
  jwtSecret: env.JWT_SECRET,
  cookieSameSite: env.COOKIE_SAMESITE,
  secureCookies: env.NODE_ENV === 'production',
  bcryptCost: env.BCRYPT_COST,
  trustProxy: env.TRUST_PROXY,
  webhookSecret: env.PAYMENT_PROVIDER === 'mercadopago' ? env.MP_WEBHOOK_SECRET : undefined,
});
const server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err, port: env.PORT }, 'Não foi possível abrir a porta');
    process.exit(1);
  }
  logger.info({ port: env.PORT }, 'API no ar');
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Encerrando');
  const timer = setTimeout(() => {
    logger.error('Encerramento forçado por tempo esgotado');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  server.close((closeErr) => {
    if (closeErr) logger.error({ err: closeErr }, 'Erro ao fechar o servidor HTTP');
    pool
      .end()
      .then(() => process.exit(closeErr ? 1 : 0))
      .catch((err: unknown) => {
        logger.error({ err }, 'Erro ao fechar o pool');
        process.exit(1);
      });
  });
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
