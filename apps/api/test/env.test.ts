import { EnvError, parseEnv } from '../src/config/env.js';
import { validEnv } from './helpers.js';

function failure(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof EnvError) return err;
    throw err;
  }
  throw new Error('parseEnv deveria ter falhado');
}

describe('parseEnv', () => {
  it('aplica os padrões da arquitetura', () => {
    const env = parseEnv(validEnv);
    expect(env).toMatchObject({
      PORT: 3333,
      WEB_URL: 'http://localhost:5173',
      API_PUBLIC_URL: 'http://localhost:3333',
      COOKIE_SAMESITE: 'lax',
      PAYMENT_PROVIDER: 'fake',
      TEST_DATABASE_URL: 'postgres://bancada:bancada@localhost:5432/bancada_test',
    });
  });

  it('converte PORT e S3_FORCE_PATH_STYLE', () => {
    const env = parseEnv({ ...validEnv, PORT: '4000', S3_FORCE_PATH_STYLE: 'true' });
    expect(env.PORT).toBe(4000);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('trata variáveis S3 vazias como ausentes', () => {
    const env = parseEnv({ ...validEnv, S3_ENDPOINT: '', S3_BUCKET: '' });
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_BUCKET).toBeUndefined();
  });

  it('lista TODAS as variáveis inválidas em PT-BR', () => {
    const error = failure({ PORT: 'abc', WEB_URL: 'não é url', COOKIE_SAMESITE: 'strict' });
    expect(error.issues.map((i) => i.variable).sort()).toEqual(
      ['COOKIE_SAMESITE', 'DATABASE_URL', 'JWT_SECRET', 'PORT', 'WEB_URL'].sort(),
    );
    expect(error.message).toContain('Variáveis de ambiente inválidas');
    for (const name of ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'WEB_URL', 'COOKIE_SAMESITE']) {
      expect(error.message).toContain(name);
    }
  });

  it('exige JWT_SECRET com no mínimo 32 caracteres', () => {
    const error = failure({ ...validEnv, JWT_SECRET: 'curto' });
    expect(error.issues).toEqual([
      { variable: 'JWT_SECRET', message: 'deve ter no mínimo 32 caracteres' },
    ]);
  });

  it('exige MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET com PAYMENT_PROVIDER=mercadopago', () => {
    const error = failure({ ...validEnv, PAYMENT_PROVIDER: 'mercadopago' });
    expect(error.issues.map((i) => i.variable).sort()).toEqual([
      'MP_ACCESS_TOKEN',
      'MP_WEBHOOK_SECRET',
    ]);
    expect(error.message).toContain('obrigatória quando PAYMENT_PROVIDER=mercadopago');
  });

  it('aceita mercadopago com as credenciais', () => {
    const env = parseEnv({
      ...validEnv,
      PAYMENT_PROVIDER: 'mercadopago',
      MP_ACCESS_TOKEN: 'token',
      MP_WEBHOOK_SECRET: 'segredo',
    });
    expect(env.PAYMENT_PROVIDER).toBe('mercadopago');
    expect(env.MP_ACCESS_TOKEN).toBe('token');
  });

  it('não exige MP_* no modo fake', () => {
    expect(() => parseEnv({ ...validEnv, PAYMENT_PROVIDER: 'fake' })).not.toThrow();
  });

  describe('provedor fake em produção', () => {
    it('recusa NODE_ENV=production com PAYMENT_PROVIDER=fake (inclusive o padrão)', () => {
      const error = failure({ ...validEnv, NODE_ENV: 'production' });
      expect(error.issues.map((i) => i.variable)).toEqual(['PAYMENT_PROVIDER']);
      expect(error.message).toContain('ALLOW_FAKE_PAYMENTS=true');
      expect(error.message).toContain('produção');
      const explicit = failure({ ...validEnv, NODE_ENV: 'production', PAYMENT_PROVIDER: 'fake' });
      expect(explicit.issues[0]?.variable).toBe('PAYMENT_PROVIDER');
    });

    it('aceita com ALLOW_FAKE_PAYMENTS=true', () => {
      const env = parseEnv({ ...validEnv, NODE_ENV: 'production', ALLOW_FAKE_PAYMENTS: 'true' });
      expect(env.ALLOW_FAKE_PAYMENTS).toBe(true);
    });

    it('ALLOW_FAKE_PAYMENTS=false continua recusando', () => {
      expect(
        failure({ ...validEnv, NODE_ENV: 'production', ALLOW_FAKE_PAYMENTS: 'false' }).issues,
      ).toHaveLength(1);
    });

    it('ALLOW_FAKE_PAYMENTS inválido é listado como variável inválida', () => {
      const error = failure({ ...validEnv, ALLOW_FAKE_PAYMENTS: 'sim' });
      expect(error.issues.map((i) => i.variable)).toEqual(['ALLOW_FAKE_PAYMENTS']);
    });

    it('fora de produção o fake é livre; em produção o mercadopago também', () => {
      expect(() => parseEnv({ ...validEnv, NODE_ENV: 'development' })).not.toThrow();
      expect(() => parseEnv(validEnv)).not.toThrow();
      expect(() =>
        parseEnv({
          ...validEnv,
          NODE_ENV: 'production',
          PAYMENT_PROVIDER: 'mercadopago',
          MP_ACCESS_TOKEN: 't',
          MP_WEBHOOK_SECRET: 's',
        }),
      ).not.toThrow();
    });
  });

  describe('BCRYPT_COST e TRUST_PROXY', () => {
    it('BCRYPT_COST padrão 12; aceita 4 a 15; rejeita fora disso', () => {
      expect(parseEnv(validEnv).BCRYPT_COST).toBe(12);
      expect(parseEnv({ ...validEnv, BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
      for (const bad of ['3', '16', 'abc', '10.5']) {
        expect(failure({ ...validEnv, BCRYPT_COST: bad }).issues[0]?.variable).toBe('BCRYPT_COST');
      }
    });

    it('TRUST_PROXY: padrão false; true/false/número/lista de redes', () => {
      expect(parseEnv(validEnv).TRUST_PROXY).toBe(false);
      expect(parseEnv({ ...validEnv, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
      expect(parseEnv({ ...validEnv, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
      expect(parseEnv({ ...validEnv, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
      expect(parseEnv({ ...validEnv, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).TRUST_PROXY).toBe(
        'loopback, 10.0.0.0/8',
      );
    });
  });

  it('rejeita PAYMENT_PROVIDER desconhecido', () => {
    expect(failure({ ...validEnv, PAYMENT_PROVIDER: 'paypal' }).issues[0]?.variable).toBe(
      'PAYMENT_PROVIDER',
    );
  });
});
