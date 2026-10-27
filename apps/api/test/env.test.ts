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

  it('fora de produção as variáveis S3 usam os padrões do MinIO local; vazias contam como ausentes', () => {
    const env = parseEnv({ ...validEnv, S3_ENDPOINT: '', S3_BUCKET: '' });
    expect(env).toMatchObject({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'bancada',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadmin',
      S3_PUBLIC_URL: 'http://localhost:9000/bancada',
      S3_FORCE_PATH_STYLE: true,
    });
  });

  it('valores S3 informados vencem os padrões', () => {
    const env = parseEnv({
      ...validEnv,
      S3_BUCKET: 'outro',
      S3_FORCE_PATH_STYLE: 'false',
      S3_ENDPOINT: 'http://minio:9000',
    });
    expect(env).toMatchObject({
      S3_BUCKET: 'outro',
      S3_FORCE_PATH_STYLE: false,
      S3_ENDPOINT: 'http://minio:9000',
    });
  });

  describe('S3 em produção', () => {
    const prod = {
      ...validEnv,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'mercadopago',
      MP_ACCESS_TOKEN: 't',
      MP_WEBHOOK_SECRET: 's',
    };
    const s3 = {
      S3_REGION: 'sa-east-1',
      S3_BUCKET: 'meu-bucket',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'segredo',
      S3_PUBLIC_URL: 'https://meu-bucket.s3.sa-east-1.amazonaws.com',
      S3_FORCE_PATH_STYLE: 'false',
    };

    it('exige todas as S3_* (exceto S3_ENDPOINT), sem usar os padrões do MinIO', () => {
      const error = failure(prod);
      expect(error.issues.map((i) => i.variable).sort()).toEqual(Object.keys(s3).sort());
      expect(error.message).toContain('obrigatória fora de desenvolvimento/teste');
    });

    it('com todas definidas sobe, e S3_ENDPOINT fica ausente (AWS)', () => {
      const env = parseEnv({ ...prod, ...s3 });
      expect(env.S3_ENDPOINT).toBeUndefined();
      expect(env.S3_FORCE_PATH_STYLE).toBe(false);
      expect(env.S3_BUCKET).toBe('meu-bucket');
    });

    it.each(['staging', 'qa', 'prod'])(
      'NODE_ENV=%s (não é development/test) também exige as S3_*: sem cair em localhost:9000',
      (nodeEnv) => {
        const error = failure({ ...validEnv, NODE_ENV: nodeEnv });
        expect(error.issues.map((i) => i.variable)).toEqual(
          expect.arrayContaining(Object.keys(s3)),
        );
      },
    );

    it.each(['development', 'test'])('NODE_ENV=%s usa os padrões do MinIO local', (nodeEnv) => {
      expect(parseEnv({ ...validEnv, NODE_ENV: nodeEnv }).S3_ENDPOINT).toBe(
        'http://localhost:9000',
      );
    });

    it('S3_PUBLIC_URL precisa ser uma URL', () => {
      expect(failure({ ...prod, ...s3, S3_PUBLIC_URL: 'nao-url' }).issues[0]?.variable).toBe(
        'S3_PUBLIC_URL',
      );
    });
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
    const s3Prod = {
      S3_REGION: 'sa-east-1',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_PUBLIC_URL: 'https://cdn.example.com',
      S3_FORCE_PATH_STYLE: 'false',
    };
    it('recusa NODE_ENV=production com PAYMENT_PROVIDER=fake (inclusive o padrão)', () => {
      const error = failure({ ...validEnv, ...s3Prod, NODE_ENV: 'production' });
      expect(error.issues.map((i) => i.variable)).toEqual(['PAYMENT_PROVIDER']);
      expect(error.message).toContain('ALLOW_FAKE_PAYMENTS=true');
      expect(error.message).toContain('produção');
      const explicit = failure({
        ...validEnv,
        ...s3Prod,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'fake',
      });
      expect(explicit.issues[0]?.variable).toBe('PAYMENT_PROVIDER');
    });

    it('aceita com ALLOW_FAKE_PAYMENTS=true', () => {
      const env = parseEnv({
        ...validEnv,
        ...s3Prod,
        NODE_ENV: 'production',
        ALLOW_FAKE_PAYMENTS: 'true',
      });
      expect(env.ALLOW_FAKE_PAYMENTS).toBe(true);
    });

    it('ALLOW_FAKE_PAYMENTS=false continua recusando', () => {
      expect(
        failure({
          ...validEnv,
          ...s3Prod,
          NODE_ENV: 'production',
          ALLOW_FAKE_PAYMENTS: 'false',
        }).issues,
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
          ...s3Prod,
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
