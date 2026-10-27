import { z } from 'zod';

const optionalString = z.string().optional();

const envObject = z.object({
  DATABASE_URL: z
    .string({ error: 'é obrigatória' })
    .min(1, { error: 'é obrigatória' })
    .pipe(z.url({ error: 'deve ser uma URL válida' })),
  TEST_DATABASE_URL: z
    .url({ error: 'deve ser uma URL válida' })
    .default('postgres://bancada:bancada@localhost:5432/bancada_test'),
  PORT: z.coerce
    .number({ error: 'deve ser um número' })
    .int({ error: 'deve ser um número inteiro' })
    .min(1, { error: 'deve estar entre 1 e 65535' })
    .max(65535, { error: 'deve estar entre 1 e 65535' })
    .default(3333),
  WEB_URL: z.url({ error: 'deve ser uma URL válida' }).default('http://localhost:5173'),
  API_PUBLIC_URL: z.url({ error: 'deve ser uma URL válida' }).default('http://localhost:3333'),
  JWT_SECRET: z
    .string({ error: 'é obrigatória' })
    .min(32, { error: 'deve ter no mínimo 32 caracteres' }),
  COOKIE_SAMESITE: z.enum(['lax', 'none'], { error: 'deve ser "lax" ou "none"' }).default('lax'),
  NODE_ENV: optionalString,
  // Custo do bcrypt (12 em produção; os testes usam 4).
  BCRYPT_COST: z.coerce
    .number({ error: 'deve ser um número' })
    .int({ error: 'deve ser um número inteiro' })
    .min(4, { error: 'deve estar entre 4 e 15' })
    .max(15, { error: 'deve estar entre 4 e 15' })
    .default(12),
  // Atrás de proxy/load balancer: "true", número de proxies ou lista de redes (ex.: "loopback").
  // Com "false" (padrão) o IP do rate limit é o da conexão direta.
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): boolean | number | string => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return /^\d+$/.test(v) ? Number(v) : v;
    }),
  // Libera PAYMENT_PROVIDER=fake em produção (pagamentos simulados, de propósito).
  ALLOW_FAKE_PAYMENTS: z
    .enum(['true', 'false'], { error: 'deve ser "true" ou "false"' })
    .transform((v) => v === 'true')
    .optional(),
  PAYMENT_PROVIDER: z
    .enum(['fake', 'mercadopago'], { error: 'deve ser "fake" ou "mercadopago"' })
    .default('fake'),
  MP_ACCESS_TOKEN: optionalString,
  MP_WEBHOOK_SECRET: optionalString,
  S3_ENDPOINT: z.url({ error: 'deve ser uma URL válida' }).optional(),
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PUBLIC_URL: z.url({ error: 'deve ser uma URL válida' }).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'], { error: 'deve ser "true" ou "false"' })
    .transform((v) => v === 'true')
    .optional(),
});

const LOCAL_S3 = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'bancada',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  publicUrl: 'http://localhost:9000/bancada',
} as const;

// Staging e produção (qualquer outro NODE_ENV) não caem em silêncio em localhost:9000.
function usesLocalS3Defaults(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || nodeEnv === 'development' || nodeEnv === 'test';
}

const S3_REQUIRED_IN_PRODUCTION = [
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_URL',
  'S3_FORCE_PATH_STYLE',
] as const;

const envSchema = envObject
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      env.PAYMENT_PROVIDER === 'fake' &&
      !env.ALLOW_FAKE_PAYMENTS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message:
          'o provedor "fake" não pode ser usado em produção (pagamentos simulados). ' +
          'Use "mercadopago" ou, se for de propósito, defina ALLOW_FAKE_PAYMENTS=true',
      });
    }
    if (env.PAYMENT_PROVIDER === 'mercadopago') {
      for (const name of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'] as const) {
        if (!env[name]) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'é obrigatória quando PAYMENT_PROVIDER=mercadopago',
          });
        }
      }
    }
    // Em produção não há padrão: o bucket real precisa ser configurado de propósito
    // (S3_ENDPOINT continua opcional: vazio na AWS).
    if (!usesLocalS3Defaults(env.NODE_ENV)) {
      for (const name of S3_REQUIRED_IN_PRODUCTION) {
        if (env[name] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message:
              'é obrigatória fora de desenvolvimento/teste (não há padrão para o bucket real)',
          });
        }
      }
    }
  })
  .transform((env) => {
    // O padrão é o MinIO local do docker-compose, só com NODE_ENV ausente, development ou test.
    const local = usesLocalS3Defaults(env.NODE_ENV);
    return {
      ...env,
      S3_ENDPOINT: env.S3_ENDPOINT ?? (local ? LOCAL_S3.endpoint : undefined),
      // Em produção a refinação acima garante que os campos abaixo existem.
      S3_REGION: (env.S3_REGION ?? (local ? LOCAL_S3.region : undefined)) as string,
      S3_BUCKET: (env.S3_BUCKET ?? (local ? LOCAL_S3.bucket : undefined)) as string,
      S3_ACCESS_KEY_ID: (env.S3_ACCESS_KEY_ID ??
        (local ? LOCAL_S3.accessKeyId : undefined)) as string,
      S3_SECRET_ACCESS_KEY: (env.S3_SECRET_ACCESS_KEY ??
        (local ? LOCAL_S3.secretAccessKey : undefined)) as string,
      S3_PUBLIC_URL: (env.S3_PUBLIC_URL ?? (local ? LOCAL_S3.publicUrl : undefined)) as string,
      S3_FORCE_PATH_STYLE: (env.S3_FORCE_PATH_STYLE ?? (local ? true : undefined)) as boolean,
    };
  });

export type Env = z.infer<typeof envSchema>;

export interface EnvIssue {
  variable: string;
  message: string;
}

export class EnvError extends Error {
  readonly issues: EnvIssue[];

  constructor(issues: EnvIssue[]) {
    const lines = issues.map((i) => `  - ${i.variable}: ${i.message}`);
    super(
      `Variáveis de ambiente inválidas:\n${lines.join('\n')}\n` +
        'Confira o arquivo apps/api/.env (modelo em apps/api/.env.example).',
    );
    this.name = 'EnvError';
    this.issues = issues;
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Variável vazia (ex.: "S3_ENDPOINT=") conta como ausente.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => ({
      variable: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}

// Para scripts que só precisam do banco (migrate, seed): não exigem as demais variáveis.
export function loadDatabaseUrl(source: Record<string, string | undefined> = process.env): string {
  const result = envObject.pick({ DATABASE_URL: true }).safeParse(source);
  if (result.success) return result.data.DATABASE_URL;
  throw new EnvError(
    result.error.issues.map((issue) => ({
      variable: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
