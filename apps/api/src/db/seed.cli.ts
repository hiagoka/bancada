import pino from 'pino';
import { loadDatabaseUrl } from '../config/env.js';
import { createPool } from './pool.js';
import { runSeed } from './seed.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const pool = createPool(loadDatabaseUrl());
try {
  await runSeed(pool, logger);
} catch (err) {
  logger.error({ err }, 'Seed falhou');
  process.exitCode = 1;
} finally {
  await pool.end();
}
