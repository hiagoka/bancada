import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pino from 'pino';

const envFile = resolve(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const DEFAULT_TEST_DATABASE_URL = 'postgres://bancada:bancada@localhost:5432/bancada_test';

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

export const silentLogger = pino({ level: 'silent' });

export const validEnv = {
  DATABASE_URL: 'postgres://bancada:bancada@localhost:5432/bancada',
  JWT_SECRET: 'x'.repeat(32),
};

// Dependências de autenticação do createApp nos testes (custo 4 do bcrypt: rápido).
export const authDeps = {
  jwtSecret: 'segredo-de-teste-com-mais-de-32-caracteres',
  cookieSameSite: 'lax' as const,
  bcryptCost: 4,
};
