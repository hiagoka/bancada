import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors.js';
import type { AdminRecord } from './admins.repository.js';
import type { AuthService } from './auth.service.js';

declare global {
  // Declaration merging é a forma suportada pelo Express de tipar req.admin.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminRecord;
    }
  }
}

export const ADMIN_COOKIE = 'bancada_admin';

// Sem cookie, token inválido/expirado/adulterado ou admin removido: sempre a MESMA resposta 401.
const unauthorized = (): AppError => new AppError(401, 'UNAUTHORIZED', 'Não autenticado');

export function createRequireAdmin(authService: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[ADMIN_COOKIE];
    if (typeof token !== 'string' || token === '') throw unauthorized();

    const adminId = authService.verifyToken(token);
    if (!adminId) throw unauthorized();

    // O admin é carregado do banco: token de admin removido deixa de valer na hora.
    const admin = await authService.findAdmin(adminId);
    if (!admin) throw unauthorized();

    req.admin = admin;
    next();
  };
}
