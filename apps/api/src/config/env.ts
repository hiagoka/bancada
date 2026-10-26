import { z } from 'zod';

const optionalString = z.string().optional();

const envSchema = z
  .object({
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
    PAYMENT_PROVIDER: z
      .enum(['fake', 'mercadopago'], { error: 'deve ser "fake" ou "mercadopago"' })
      .default('fake'),
    MP_ACCESS_TOKEN: optionalString,
    MP_WEBHOOK_SECRET: optionalString,
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_PUBLIC_URL: optionalString,
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'], { error: 'deve ser "true" ou "false"' })
      .transform((v) => v === 'true')
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER !== 'mercadopago') return;
    for (const name of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'] as const) {
      if (!env[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'é obrigatória quando PAYMENT_PROVIDER=mercadopago',
        });
      }
    }
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
