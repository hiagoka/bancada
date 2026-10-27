import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

// Sem imports locais: o globalSetup é carregado pelo require nativo do Jest,
// que não aplica o moduleNameMapper (".js" -> ".ts").
const DEFAULT_TEST_DATABASE_URL = 'postgres://bancada:bancada@localhost:5432/bancada_test';

// Cria o banco de TEST_DATABASE_URL se não existir, recria o schema e roda as migrações.
export default async function globalSetup(): Promise<void> {
  await probeMinio();
  const apiDir = resolve(__dirname, '..');
  const envFile = resolve(apiDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const testUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const url = new URL(testUrl);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`Nome de banco de teste inválido em TEST_DATABASE_URL: "${dbName}"`);
  }
  // O setup apaga o schema inteiro: nunca pode apontar para um banco que não seja de teste.
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL deve apontar para um banco terminado em "_test" (recebido: "${dbName}"). ` +
        'O globalSetup recria o schema e apagaria dados reais.',
    );
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    const reason =
      err instanceof Error ? err.message || (err as NodeJS.ErrnoException).code : String(err);
    throw new Error(
      `Não foi possível conectar ao Postgres de teste (${adminUrl.host}): ${reason}. ` +
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

  const db = new Client({ connectionString: testUrl });
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE');
    await db.query('CREATE SCHEMA public');
  } finally {
    await db.end();
  }

  // Usa o runner de verdade (mesmo código do `npm run migrate`).
  const migrate = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.cli.ts'], {
    cwd: apiDir,
    env: { PATH: process.env.PATH, DATABASE_URL: testUrl, LOG_LEVEL: 'warn' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (migrate.status !== 0) {
    throw new Error(`Falha ao migrar o banco de teste:\n${migrate.stdout}\n${migrate.stderr}`);
  }
}

// Os testes de integração do S3 usam o MinIO real. Avisa aqui (uma vez) se não estiver no ar;
// com REQUIRE_MINIO=true o próprio arquivo de testes FALHA em vez de pular.
async function probeMinio(): Promise<void> {
  const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000';
  try {
    const res = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2000) });
    process.env.MINIO_AVAILABLE = res.ok ? 'true' : 'false';
  } catch {
    process.env.MINIO_AVAILABLE = 'false';
  }
  if (process.env.MINIO_AVAILABLE !== 'true' && process.env.REQUIRE_MINIO !== 'true') {
    process.stderr.write(
      `\nAVISO: MinIO não respondeu em ${endpoint}: os testes de integração do S3 serão PULADOS ` +
        '(defina REQUIRE_MINIO=true para exigir).\n',
    );
  }
}
