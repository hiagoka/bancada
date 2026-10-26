import { resolve } from 'node:path';
import pino from 'pino';
import { loadDatabaseUrl } from '../config/env.js';
import { runMigrations } from './migrate.js';
import { createPool } from './pool.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const pool = createPool(loadDatabaseUrl());
try {
  const applied = await runMigrations(pool, resolve(import.meta.dirname, 'migrations'), logger);
  logger.info({ applied }, applied.length ? 'Migrações concluídas' : 'Nada a migrar');
} catch (err) {
  logger.error({ err }, 'Migração falhou');
  process.exitCode = 1;
} finally {
  await pool.end();
}
