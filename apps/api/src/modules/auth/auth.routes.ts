import { adminSchema, loginInputSchema } from '@bancada/contracts';
import type { Logger } from 'pino';
import { Router, type CookieOptions, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../shared/errors.js';
import { TOKEN_TTL_SECONDS, type AuthService } from './auth.service.js';
import { ADMIN_COOKIE } from './require-admin.js';

export interface LoginRateLimit {
  windowMs: number;
  limit: number;
}

export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimit = { windowMs: 60_000, limit: 5 };

export interface AuthRouterDeps {
  authService: AuthService;
  requireAdmin: RequestHandler;
  sameSite: 'lax' | 'none';
  // Cookie Secure (produção). Com SameSite=None é sempre Secure.
  secure: boolean;
  loginRateLimit?: LoginRateLimit;
  logger: Logger;
}

export function createAuthRouter({
  authService,
  requireAdmin,
  sameSite,
  secure,
  loginRateLimit = DEFAULT_LOGIN_RATE_LIMIT,
  logger,
}: AuthRouterDeps): Router {
  const baseCookie: CookieOptions = {
    httpOnly: true,
    sameSite,
    secure: secure || sameSite === 'none',
    path: '/',
  };

  // Um limiter por router (por createApp): sem estado global. A chave é req.ip; atrás de proxy
  // configure TRUST_PROXY, senão todos os clientes compartilham o IP do proxy.
  const loginLimiter = rateLimit({
    windowMs: loginRateLimit.windowMs,
    limit: loginRateLimit.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, _res, next) => {
      logger.warn({ ip: req.ip }, 'Limite de tentativas de login excedido');
      next(
        new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um minuto e tente de novo.'),
      );
    },
  });

  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const input = loginInputSchema.parse(req.body);
    let admin;
    try {
      admin = await authService.login(input.email, input.password);
    } catch (err) {
      // Rastro para detectar força bruta: IP e e-mail tentado, NUNCA a senha.
      if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
        logger.warn({ ip: req.ip, email: input.email }, 'Login inválido');
      }
      throw err;
    }
    res.cookie(ADMIN_COOKIE, authService.signToken(admin.id), {
      ...baseCookie,
      maxAge: TOKEN_TTL_SECONDS * 1000,
    });
    res.json({ data: adminSchema.parse(admin) });
  });

  // Limpa o cookie com os MESMOS atributos com que foi gravado. Funciona mesmo sem sessão.
  router.post('/logout', (_req, res) => {
    res.clearCookie(ADMIN_COOKIE, baseCookie);
    res.json({ data: { ok: true } });
  });

  router.get('/me', requireAdmin, (req, res) => {
    res.json({ data: adminSchema.parse(req.admin) });
  });

  return router;
}
