import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { stdSerializers } from 'pino';
import { pinoHttp } from 'pino-http';
import { AppError } from './shared/errors.js';
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
}

export function createApp({ pool, logger, webUrl }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      // Nunca logar cookie, token ou credenciais (ARCHITECTURE.md, seção 12).
      serializers: {
        req: (req: Parameters<typeof stdSerializers.req>[0]) => {
          const { headers, ...rest } = stdSerializers.req(req);
          const safeHeaders = omitKeys(headers, ['cookie', 'authorization']);
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

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
