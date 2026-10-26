import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

// Sem imports locais: o globalSetup é carregado pelo require nativo do Jest,
// que não aplica o moduleNameMapper (".js" -> ".ts").
const DEFAULT_TEST_DATABASE_URL = 'postgres://bancada:bancada@localhost:5432/bancada_test';

// Cria o banco de TEST_DATABASE_URL se não existir. Schema e migrações vêm na T05.
export default async function globalSetup(): Promise<void> {
  const envFile = resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = new URL(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`Nome de banco de teste inválido em TEST_DATABASE_URL: "${dbName}"`);
  }

  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  try {
    await admin.connect();
  } catch (err) {
    const reason =
      err instanceof Error ? err.message || (err as NodeJS.ErrnoException).code : String(err);
    throw new Error(
      `Não foi possível conectar ao Postgres de teste (${url.host}): ${reason}. ` +
        'Suba o banco (docker compose up -d db) ou ajuste TEST_DATABASE_URL.',
      { cause: err },
    );
  }
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}
