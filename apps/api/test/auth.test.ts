import { adminSchema } from '@bancada/contracts';
import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import {
  ADMIN,
  CSRF,
  algNoneToken,
  expiredTokenFor,
  insertAdminWithPassword,
  tamperedToken,
  tokenFor,
} from './auth-helpers.js';
import { resetDb } from './db-helpers.js';
import { authDeps, silentLogger, testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';

function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
  return createApp({
    ...authDeps,
    pool,
    logger: silentLogger,
    webUrl,
    storage: new FakeStorageService(),
    gateway: new FakePaymentGateway({ webUrl }),
    ...overrides,
  });
}

let app: Express;

beforeEach(async () => {
  await resetDb(pool);
  app = buildApp();
});

afterAll(async () => {
  await pool.end();
});

function login(target: Express, body: object = { email: ADMIN.email, password: ADMIN.password }) {
  return request(target).post('/auth/login').set(CSRF).send(body);
}

function cookieFrom(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = header?.find((c) => c.startsWith('bancada_admin='));
  if (!raw) throw new Error('cookie bancada_admin não encontrado');
  return raw.split(';')[0]!;
}

function setCookieOf(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('bancada_admin=')) ?? '';
}

describe('POST /auth/login', () => {
  it('login certo: 200 {data: admin} validado por adminSchema, sem password_hash', async () => {
    const id = await insertAdminWithPassword(pool);
    const res = await login(app);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(adminSchema.strict().parse(res.body.data)).toEqual({
      id,
      email: ADMIN.email,
      name: ADMIN.name,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password|senha/i);
  });

  it('grava o cookie httpOnly com SameSite, Path e Max-Age (8h) corretos; sem Secure fora de produção', async () => {
    await insertAdminWithPassword(pool);
    const cookie = setCookieOf(await login(app));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).not.toContain('Secure');
  });

  it('Secure em produção (secureCookies)', async () => {
    await insertAdminWithPassword(pool);
    const cookie = setCookieOf(await login(buildApp({ secureCookies: true })));
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('SameSite=None força Secure mesmo fora de produção', async () => {
    await insertAdminWithPassword(pool);
    const cookie = setCookieOf(await login(buildApp({ cookieSameSite: 'none' })));
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('o JWT é HS256, expira em 8h e leva só { sub }', async () => {
    const id = await insertAdminWithPassword(pool);
    const res = await login(app);
    const token = cookieFrom(res).split('=')[1]!;
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header).toMatchObject({ alg: 'HS256' });
    expect(payload.sub).toBe(id);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('e-mail é normalizado para minúsculo', async () => {
    await insertAdminWithPassword(pool);
    const res = await login(app, { email: '  ADMIN@Bancada.DEV ', password: ADMIN.password });
    expect(res.status).toBe(200);
  });

  it('senha errada e e-mail inexistente dão EXATAMENTE a mesma resposta 401', async () => {
    await insertAdminWithPassword(pool);
    const wrong = await login(app, { email: ADMIN.email, password: 'senha-errada' });
    const missing = await login(app, { email: 'ninguem@bancada.dev', password: 'senha-errada' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(missing.headers['set-cookie']).toBeUndefined();
  });

  it('e-mail inexistente também gasta o tempo do bcrypt (hash dummy): sem enumeração por tempo', async () => {
    // Hash do admin e hash dummy no mesmo custo (em produção, ambos 12).
    await insertAdminWithPassword(pool, {}, 10);
    const slowApp = buildApp({ bcryptCost: 10 });
    const time = async (email: string): Promise<number> => {
      const start = process.hrtime.bigint();
      await login(slowApp, { email, password: 'senha-errada' });
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    await time(ADMIN.email); // aquece (hash dummy preguiçoso)
    const wrongPassword = await time(ADMIN.email);
    const missingEmail = await time('ninguem@bancada.dev');
    expect(wrongPassword).toBeGreaterThan(20);
    expect(missingEmail).toBeGreaterThan(wrongPassword * 0.5);
  });

  it('corpo inválido: 400 VALIDATION_ERROR em PT-BR', async () => {
    const res = await login(app, { email: 'x', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('Informe um e-mail válido');
  });

  it('admin é buscado pelo e-mail mesmo com outros admins cadastrados', async () => {
    await insertAdminWithPassword(pool, {
      email: 'outro@bancada.dev',
      password: 'outra-senha-longa',
    });
    await insertAdminWithPassword(pool);
    const res = await login(app);
    expect(res.body.data.email).toBe(ADMIN.email);
  });
});

describe('rate limit do login', () => {
  it('a 6ª tentativa no mesmo minuto dá 429 RATE_LIMITED no envelope padrão', async () => {
    await insertAdminWithPassword(pool);
    const limited = buildApp();
    for (let i = 1; i <= 5; i++) {
      const res = await login(limited, { email: ADMIN.email, password: 'errada' });
      expect(res.status).toBe(401);
    }
    const sixth = await login(limited, { email: ADMIN.email, password: 'errada' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    expect(typeof sixth.body.error.message).toBe('string');
    // Depois de bloqueado, nem a senha certa entra.
    const correct = await login(limited);
    expect(correct.status).toBe(429);
  });

  it('as 5 primeiras tentativas passam, inclusive a certa', async () => {
    await insertAdminWithPassword(pool);
    const limited = buildApp();
    for (let i = 0; i < 4; i++) await login(limited, { email: ADMIN.email, password: 'errada' });
    expect((await login(limited)).status).toBe(200);
  });

  it('não afeta outras rotas', async () => {
    await insertAdminWithPassword(pool);
    const limited = buildApp();
    for (let i = 0; i < 7; i++) await login(limited, { email: ADMIN.email, password: 'errada' });
    expect((await request(limited).get('/products')).status).toBe(200);
    expect((await request(limited).get('/health')).status).toBe(200);
    expect((await request(limited).get('/auth/me')).status).toBe(401);
    expect((await request(limited).post('/auth/logout').set(CSRF).send({})).status).toBe(200);
  });

  it('cada app tem seu próprio limiter (sem singleton global)', async () => {
    await insertAdminWithPassword(pool);
    const a = buildApp();
    const b = buildApp();
    for (let i = 0; i < 6; i++) await login(a, { email: ADMIN.email, password: 'errada' });
    expect((await login(b)).status).toBe(200);
  });

  it('sem trustProxy o IP é o da conexão: X-Forwarded-For forjado não burla o limite', async () => {
    await insertAdminWithPassword(pool);
    const limited = buildApp();
    // O express-rate-limit avisa (console.error) de X-Forwarded-For sem trust proxy: esperado aqui.
    const warning = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) {
      await login(limited, { email: ADMIN.email, password: 'errada' }).set(
        'X-Forwarded-For',
        `10.0.0.${i}`,
      );
    }
    const sixth = await login(limited).set('X-Forwarded-For', '10.9.9.9');
    warning.mockRestore();
    expect(sixth.status).toBe(429);
  });

  it('com trustProxy o IP vem do X-Forwarded-For (cada cliente atrás do proxy tem seu limite)', async () => {
    await insertAdminWithPassword(pool);
    const behindProxy = buildApp({ trustProxy: 1 });
    for (let i = 0; i < 6; i++) {
      await login(behindProxy, { email: ADMIN.email, password: 'errada' }).set(
        'X-Forwarded-For',
        '203.0.113.7',
      );
    }
    expect((await login(behindProxy).set('X-Forwarded-For', '203.0.113.7')).status).toBe(429);
    expect((await login(behindProxy).set('X-Forwarded-For', '198.51.100.9')).status).toBe(200);
  });

  it('janela e limite são injetáveis', async () => {
    await insertAdminWithPassword(pool);
    const tight = buildApp({ loginRateLimit: { windowMs: 60_000, limit: 2 } });
    await login(tight, { email: ADMIN.email, password: 'errada' });
    await login(tight, { email: ADMIN.email, password: 'errada' });
    expect((await login(tight)).status).toBe(429);
  });

  it('requisição rejeitada pelo CSRF não consome tentativas do login', async () => {
    await insertAdminWithPassword(pool);
    const limited = buildApp();
    for (let i = 0; i < 10; i++) {
      await request(limited).post('/auth/login').send({ email: ADMIN.email, password: 'x' });
    }
    expect((await login(limited)).status).toBe(200);
  });
});

describe('GET /auth/me e requireAdmin', () => {
  it('/auth/me com cookie válido: 200 sem password_hash', async () => {
    await insertAdminWithPassword(pool);
    const cookie = cookieFrom(await login(app));
    const res = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(adminSchema.strict().safeParse(res.body.data).success).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
  });

  it('GET /auth/me não exige o header X-Requested-With', async () => {
    await insertAdminWithPassword(pool);
    const cookie = cookieFrom(await login(app));
    const res = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  const unauthorized = (res: request.Response) => {
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  };

  it('sem cookie: 401 UNAUTHORIZED', async () => {
    unauthorized(await request(app).get('/auth/me'));
  });

  it('rotas /admin/* sem cookie: 401 (inclusive caminhos inexistentes)', async () => {
    unauthorized(await request(app).get('/admin/products'));
    unauthorized(await request(app).get('/admin/qualquer/coisa'));
  });

  it('todos os casos inválidos dão a MESMA resposta 401', async () => {
    const id = await insertAdminWithPassword(pool);
    const other = await insertAdminWithPassword(pool, { email: 'outro@bancada.dev' });
    const removed = await insertAdminWithPassword(pool, { email: 'removido@bancada.dev' });
    const removedToken = tokenFor(removed);
    await pool.query('DELETE FROM admins WHERE id = $1', [removed]);

    const tokens: Record<string, string> = {
      lixo: 'isto-nao-e-um-jwt',
      vazio: '',
      expirado: expiredTokenFor(id),
      'outro segredo': tokenFor(id, { secret: 'outro-segredo-com-mais-de-32-caracteres!!' }),
      'alg none': algNoneToken(id),
      'HS512 (algoritmo não permitido)': tokenFor(id, { algorithm: 'HS512' }),
      adulterado: tamperedToken(id, other),
      'admin removido': removedToken,
      'sub que não é UUID': tokenFor('não-é-uuid'),
    };
    const bodies: unknown[] = [];
    for (const [name, token] of Object.entries(tokens)) {
      for (const path of ['/auth/me', '/admin/products']) {
        const res = await request(app).get(path).set('Cookie', `bancada_admin=${token}`);
        expect([name, res.status]).toEqual([name, 401]);
        bodies.push(res.body);
      }
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('token válido de um admin que ainda existe passa em /admin/* (cai no 404 padrão, sem rotas)', async () => {
    const id = await insertAdminWithPassword(pool);
    const res = await request(app)
      .get('/admin/produtos-inexistentes')
      .set('Cookie', `bancada_admin=${tokenFor(id)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('usa o admin do banco (nome atualizado aparece sem novo login)', async () => {
    await insertAdminWithPassword(pool);
    const cookie = cookieFrom(await login(app));
    await pool.query(`UPDATE admins SET name = 'Novo Nome'`);
    const res = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(res.body.data.name).toBe('Novo Nome');
  });
});

describe('POST /auth/logout', () => {
  it('limpa o cookie com os mesmos atributos e o /auth/me depois dá 401', async () => {
    await insertAdminWithPassword(pool);
    const secureApp = buildApp({ secureCookies: true, cookieSameSite: 'none' });
    const cookie = cookieFrom(await login(secureApp));
    const out = await request(secureApp)
      .post('/auth/logout')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({});
    expect(out.status).toBe(200);
    const cleared = setCookieOf(out);
    expect(cleared).toMatch(/^bancada_admin=;/);
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=None');
    expect(cleared).toContain('Secure');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    // O navegador descartou o cookie: sem ele, /auth/me dá 401.
    const me = await request(secureApp).get('/auth/me');
    expect(me.status).toBe(401);
  });

  it('funciona mesmo sem sessão (200)', async () => {
    const res = await request(app).post('/auth/logout').set(CSRF).send({});
    expect(res.status).toBe(200);
  });
});

describe('proteção CSRF (D15)', () => {
  it('POST /auth/login sem X-Requested-With: 403 CSRF_REJECTED', async () => {
    await insertAdminWithPassword(pool);
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('header com valor errado: 403', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' })
      .send({});
    expect(res.status).toBe(403);
  });

  it('com o header mas Content-Type text/plain: 403', async () => {
    await insertAdminWithPassword(pool);
    const res = await request(app)
      .post('/auth/login')
      .set('X-Requested-With', 'bancada-web')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email: ADMIN.email, password: ADMIN.password }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('Content-Type form-urlencoded ou ausente: 403', async () => {
    const form = await request(app)
      .post('/auth/login')
      .set('X-Requested-With', 'bancada-web')
      .type('form')
      .send({ email: 'a', password: 'b' });
    expect(form.status).toBe(403);
    const none = await request(app).post('/auth/logout').set('X-Requested-With', 'bancada-web');
    expect(none.status).toBe(403);
  });

  it('application/json com charset é aceito', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('X-Requested-With', 'bancada-web')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{}');
    expect(res.status).toBe(200);
  });

  it('com cookie VÁLIDO e SEM header: 403 em POST/PATCH/PUT/DELETE /admin/*', async () => {
    const id = await insertAdminWithPassword(pool);
    const cookie = `bancada_admin=${tokenFor(id)}`;
    for (const method of ['post', 'patch', 'put', 'delete'] as const) {
      const res = await request(app)[method]('/admin/qualquer').set('Cookie', cookie).send({});
      expect([method, res.status, res.body.error.code]).toEqual([method, 403, 'CSRF_REJECTED']);
    }
  });

  it('com header e cookie válidos, POST /admin/* passa pelo CSRF e pelo requireAdmin (404 sem rota)', async () => {
    const id = await insertAdminWithPassword(pool);
    const res = await request(app)
      .post('/admin/qualquer')
      .set(CSRF)
      .set('Cookie', `bancada_admin=${tokenFor(id)}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('o CSRF roda ANTES do parser de JSON: JSON malformado sem header dá 403, não 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('com o header, JSON malformado continua 400 INVALID_JSON', async () => {
    const res = await request(app).post('/auth/login').set(CSRF).send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('GET/HEAD passam sem header', async () => {
    expect((await request(app).get('/auth/me')).status).toBe(401);
    expect((await request(app).head('/admin/x')).status).toBe(401);
  });

  it('NÃO se aplica a /orders, /webhooks, /dev nem /products', async () => {
    const orders = await request(app).post('/orders').send({});
    expect(orders.status).toBe(400); // falta Idempotency-Key, não CSRF
    expect(orders.body.error.code).toBe('VALIDATION_ERROR');
    const dev = await request(app).post('/dev/payments/simulate').send({});
    expect(dev.status).toBe(400);
    expect(dev.body.error.code).toBe('VALIDATION_ERROR');
    const hook = await request(buildApp({ webhookSecret: 'segredo' }))
      .post('/webhooks/mercadopago')
      .send({});
    expect(hook.status).toBe(200); // type != payment: ignorado
  });

  it('preflight OPTIONS responde com os headers de CORS e libera X-Requested-With', async () => {
    for (const path of ['/auth/login', '/admin/products']) {
      const res = await request(app)
        .options(path)
        .set('Origin', webUrl)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(webUrl);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
        'x-requested-with',
      );
    }
  });

  it('preflight de origem não permitida não recebe allow-origin', async () => {
    const res = await request(app)
      .options('/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-requested-with');
    expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });
});

describe('cabeçalhos e logs de segurança', () => {
  it('/auth e /admin respondem com Cache-Control: no-store (dados de sessão e de clientes)', async () => {
    await insertAdminWithPassword(pool);
    const cookie = cookieFrom(await login(app));
    for (const res of [
      await login(app),
      await request(app).get('/auth/me').set('Cookie', cookie),
      await request(app).get('/auth/me'),
      await request(app).get('/admin/qualquer'),
      await request(app).post('/auth/logout').set(CSRF).send({}),
    ]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await request(app).get('/products')).headers['cache-control']).toBeUndefined();
  });

  it('login inválido e 429 deixam rastro (warn com IP e e-mail, sem a senha)', async () => {
    await insertAdminWithPassword(pool);
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const logged = buildApp({ logger, loginRateLimit: { windowMs: 60_000, limit: 2 } });
    await login(logged, { email: ADMIN.email, password: 'senha-errada-999' });
    await login(logged, { email: 'ninguem@bancada.dev', password: 'senha-errada-999' });
    await login(logged, { email: ADMIN.email, password: 'senha-errada-999' });
    const warns = lines.map((l) => JSON.parse(l)).filter((l) => l.level === 40);
    const failed = warns.filter((w) => String(w.msg).includes('Login inválido'));
    const limited = warns.filter((w) => String(w.msg).includes('Limite de tentativas'));
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ email: ADMIN.email });
    expect(typeof failed[0].ip).toBe('string');
    expect(limited).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('senha-errada-999');
  });
});

describe('logs', () => {
  it('nunca contêm senha, token, cookie nem hash', async () => {
    await insertAdminWithPassword(pool);
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const logged = buildApp({ logger });

    const ok = await login(logged);
    const token = cookieFrom(ok).split('=')[1]!;
    await login(logged, { email: ADMIN.email, password: 'senha-errada-12345' });
    await request(logged).get('/auth/me').set('Cookie', `bancada_admin=${token}`);
    await request(logged).get('/auth/me').set('Cookie', 'bancada_admin=token-invalido-xyz');
    await request(logged)
      .post('/auth/logout')
      .set(CSRF)
      .set('Cookie', `bancada_admin=${token}`)
      .send({});
    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM admins',
    );

    const out = lines.join('\n');
    expect(out).toContain('/auth/login');
    for (const secret of [
      ADMIN.password,
      'senha-errada-12345',
      token,
      'token-invalido-xyz',
      rows[0]!.password_hash,
      authDeps.jwtSecret,
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out.toLowerCase()).not.toContain('set-cookie');
    expect(out).not.toMatch(/"cookie"/i);
  });
});
