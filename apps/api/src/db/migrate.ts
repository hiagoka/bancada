import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

// Chave arbitrária (fixa) do advisory lock que serializa execuções concorrentes do runner.
const MIGRATION_LOCK_KEY = 727_001;

// Aplica os .sql de `dir` em ordem lexicográfica, cada um numa transação, e devolve as versões aplicadas.
export async function runMigrations(pool: Pool, dir: string, logger?: Logger): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const done = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
      const alreadyApplied = new Set(done.rows.map((r) => r.version));

      for (const file of files) {
        if (alreadyApplied.has(file)) continue;
        const sql = readFileSync(join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          logger?.error({ err, migration: file }, 'Falha ao aplicar migração');
          throw err;
        }
        applied.push(file);
        logger?.info({ migration: file }, 'Migração aplicada');
      }
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
  return applied;
}
