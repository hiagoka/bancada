import { EnvError, parseEnv, paymentConfigWarnings } from '../src/config/env.js';
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

  describe('S3_PUBLIC_ENDPOINT (endpoint do S3 visto pelo navegador, opcional)', () => {
    it('ausente: fica ausente (não herda padrão)', () => {
      expect(parseEnv(validEnv).S3_PUBLIC_ENDPOINT).toBeUndefined();
    });

    it('informada: vira a URL; vazia conta como ausente', () => {
      expect(
        parseEnv({ ...validEnv, S3_PUBLIC_ENDPOINT: 'http://localhost:9000' }).S3_PUBLIC_ENDPOINT,
      ).toBe('http://localhost:9000');
      expect(parseEnv({ ...validEnv, S3_PUBLIC_ENDPOINT: '' }).S3_PUBLIC_ENDPOINT).toBeUndefined();
    });

    it('precisa ser uma URL', () => {
      expect(() => parseEnv({ ...validEnv, S3_PUBLIC_ENDPOINT: 'nao-url' })).toThrow(
        /S3_PUBLIC_ENDPOINT/,
      );
    });

    it('não é exigida em produção', () => {
      const env = parseEnv({
        ...validEnv,
        NODE_ENV: 'production',
        ALLOW_FAKE_PAYMENTS: 'true',
        S3_REGION: 'sa-east-1',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_PUBLIC_URL: 'https://cdn.example.com',
        S3_FORCE_PATH_STYLE: 'false',
      });
      expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
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
      ALLOW_FAKE_PAYMENTS: 'true',
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

  it('o modo fake não exige credencial de provedor', () => {
    expect(() => parseEnv({ ...validEnv, PAYMENT_PROVIDER: 'fake' })).not.toThrow();
  });

  it('rejeita provedor desconhecido (o Mercado Pago foi removido)', () => {
    const error = failure({ ...validEnv, PAYMENT_PROVIDER: 'mercadopago' });
    expect(error.issues.map((i) => i.variable)).toEqual(['PAYMENT_PROVIDER']);
    expect(error.message).toContain('"fake" ou "abacatepay"');
  });

  describe('AbacatePay', () => {
    const abacate = {
      ...validEnv,
      PAYMENT_PROVIDER: 'abacatepay',
      ABACATEPAY_API_KEY: 'abc_dev_chave-de-teste',
      ABACATEPAY_WEBHOOK_SECRET: 'segredo-do-webhook-com-no-minimo-32-caracteres',
    };

    it('exige ABACATEPAY_API_KEY e ABACATEPAY_WEBHOOK_SECRET', () => {
      const error = failure({ ...validEnv, PAYMENT_PROVIDER: 'abacatepay' });
      expect(error.issues.map((i) => i.variable).sort()).toEqual([
        'ABACATEPAY_API_KEY',
        'ABACATEPAY_WEBHOOK_SECRET',
      ]);
      expect(error.message).toContain('obrigatória quando PAYMENT_PROVIDER=abacatepay');
    });

    it('variável vazia conta como ausente', () => {
      const error = failure({ ...abacate, ABACATEPAY_API_KEY: '' });
      expect(error.issues.map((i) => i.variable)).toEqual(['ABACATEPAY_API_KEY']);
    });

    it('o segredo do webhook precisa de no mínimo 32 caracteres', () => {
      const error = failure({ ...abacate, ABACATEPAY_WEBHOOK_SECRET: 'curto' });
      expect(error.issues).toEqual([
        { variable: 'ABACATEPAY_WEBHOOK_SECRET', message: 'deve ter no mínimo 32 caracteres' },
      ]);
    });

    it('aceita com as credenciais e usa a URL padrão da API v2', () => {
      const env = parseEnv(abacate);
      expect(env.PAYMENT_PROVIDER).toBe('abacatepay');
      expect(env.ABACATEPAY_API_KEY).toBe('abc_dev_chave-de-teste');
      expect(env.ABACATEPAY_API_URL).toBe('https://api.abacatepay.com/v2');
    });

    it('ABACATEPAY_API_URL pode ser trocada, mas precisa ser uma URL', () => {
      expect(
        parseEnv({ ...abacate, ABACATEPAY_API_URL: 'http://localhost:4010/v2' }).ABACATEPAY_API_URL,
      ).toBe('http://localhost:4010/v2');
      expect(failure({ ...abacate, ABACATEPAY_API_URL: 'nao-url' }).issues[0]?.variable).toBe(
        'ABACATEPAY_API_URL',
      );
    });

    it('não é exigida no modo fake', () => {
      expect(() => parseEnv({ ...validEnv, PAYMENT_PROVIDER: 'fake' })).not.toThrow();
    });

    it('em produção o abacatepay sobe sem ALLOW_FAKE_PAYMENTS', () => {
      expect(() =>
        parseEnv({
          ...abacate,
          NODE_ENV: 'production',
          S3_REGION: 'sa-east-1',
          S3_BUCKET: 'b',
          S3_ACCESS_KEY_ID: 'k',
          S3_SECRET_ACCESS_KEY: 's',
          S3_PUBLIC_URL: 'https://cdn.example.com',
          S3_FORCE_PATH_STYLE: 'false',
        }),
      ).not.toThrow();
    });

    it('a mensagem de erro nunca ecoa a chave nem o segredo', () => {
      const error = failure({ ...abacate, ABACATEPAY_WEBHOOK_SECRET: 'curto', PORT: 'x' });
      expect(error.message).not.toContain('abc_dev_chave-de-teste');
      expect(error.message).not.toContain('curto');
    });
  });

  describe('avisos de configuração de pagamento', () => {
    it('chave de TESTE (abc_dev_) em produção gera aviso, sem expor a chave', () => {
      const env = parseEnv({
        ...validEnv,
        PAYMENT_PROVIDER: 'abacatepay',
        ABACATEPAY_API_KEY: 'abc_dev_segredinho',
        ABACATEPAY_WEBHOOK_SECRET: 'segredo-do-webhook-com-no-minimo-32-caracteres',
        NODE_ENV: 'production',
        S3_REGION: 'r',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_PUBLIC_URL: 'https://cdn.example.com',
        S3_FORCE_PATH_STYLE: 'false',
      });
      const warnings = paymentConfigWarnings(env);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('abc_dev_');
      expect(warnings[0]).not.toContain('segredinho');
    });

    it.each([
      ['produção com abc_prod_', { NODE_ENV: 'production', ABACATEPAY_API_KEY: 'abc_prod_x' }],
      [
        'desenvolvimento com abc_dev_',
        { NODE_ENV: 'development', ABACATEPAY_API_KEY: 'abc_dev_x' },
      ],
      ['sem NODE_ENV com abc_dev_', { ABACATEPAY_API_KEY: 'abc_dev_x' }],
    ])('sem aviso: %s', (_nome, extra) => {
      const env = parseEnv({
        ...validEnv,
        PAYMENT_PROVIDER: 'abacatepay',
        ABACATEPAY_WEBHOOK_SECRET: 'segredo-do-webhook-com-no-minimo-32-caracteres',
        S3_REGION: 'r',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_PUBLIC_URL: 'https://cdn.example.com',
        S3_FORCE_PATH_STYLE: 'false',
        ...extra,
      });
      expect(paymentConfigWarnings(env)).toEqual([]);
    });

    it('o modo fake não gera aviso de chave', () => {
      expect(paymentConfigWarnings(parseEnv(validEnv))).toEqual([]);
    });
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

    it('fora de produção o fake é livre', () => {
      expect(() => parseEnv({ ...validEnv, NODE_ENV: 'development' })).not.toThrow();
      expect(() => parseEnv(validEnv)).not.toThrow();
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
