import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
  return mediaType === 'application/json';
}

// D15: requisições que alteram dados exigem X-Requested-With: bancada-web e Content-Type:
// application/json. Um site de terceiros não consegue mandar esse header sem preflight de CORS,
// e o CORS só libera WEB_URL. Deve rodar ANTES do parser de JSON.
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get('X-Requested-With') !== 'bancada-web' || !isJson(req.get('Content-Type'))) {
    throw new AppError(
      403,
      'CSRF_REJECTED',
      'Requisição recusada: faltam os cabeçalhos de segurança',
    );
  }
  next();
};
