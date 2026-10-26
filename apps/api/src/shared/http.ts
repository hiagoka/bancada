import type { ErrorCode } from '@bancada/contracts';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { z, ZodError, type ZodType } from 'zod';
import { AppError } from './errors.js';

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

// Valida req.body com o schema Zod do contracts e o substitui pelo resultado.
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', 'Rota não encontrada'));
};

function hasBodyParserType(err: unknown): err is { type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string';
}

function hasClientStatus(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}

// Erros do pg trazem `detail`/`where` com valores da linha ("Failing row contains (...)"), que
// podem incluir nome e e-mail do cliente: para eles só vão ao log code, constraint e message.
function sanitizeError(err: unknown): unknown {
  if (err instanceof Error && 'code' in err && 'severity' in err) {
    const pgErr = err as Error & { code?: unknown; constraint?: unknown };
    return {
      type: err.name,
      message: err.message,
      code: pgErr.code,
      constraint: pgErr.constraint,
      stack: err.stack,
    };
  }
  return err;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifica o handler de erro pela aridade (4 parâmetros).
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json(errorBody('VALIDATION_ERROR', 'Dados inválidos', details));
      return;
    }
    if (hasBodyParserType(err) && err.type === 'entity.parse.failed') {
      res.status(400).json(errorBody('INVALID_JSON', 'O corpo da requisição não é um JSON válido'));
      return;
    }
    // Demais erros 4xx do body-parser (charset/encoding não suportado, corpo grande demais).
    if (hasClientStatus(err)) {
      res.status(400).json(errorBody('VALIDATION_ERROR', 'Requisição inválida'));
      return;
    }
    logger.error({ err: sanitizeError(err) }, 'Erro inesperado');
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Erro interno do servidor'));
  };
}

const uuidParam = z.uuid();

// Id de rota que não é UUID não existe: 404 sem passar pelo banco (evita o erro 22P02 do pg).
export function uuidOrNotFound(value: unknown, message: string): string {
  const parsed = uuidParam.safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', message);
  return parsed.data;
}
