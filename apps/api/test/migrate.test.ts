import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { createScratchDb, type ScratchDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const migrationsDir = resolve(__dirname, '../src/db/migrations');

describe('runMigrations', () => {
  let scratch: ScratchDb;
  let pool: ReturnType<typeof createPool>;

  beforeEach(async () => {
    scratch = await createScratchDb();
    pool = createPool(scratch.url);
  });

  afterEach(async () => {
    await pool.end();
    await scratch.drop();
  });

  it('aplica 001_init.sql e registra em schema_migrations', async () => {
    const applied = await runMigrations(pool, migrationsDir, silentLogger);
    expect(applied).toEqual(['001_init.sql']);
    const { rows } = await pool.query('SELECT version, applied_at FROM schema_migrations');
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('001_init.sql');
    expect(rows[0].applied_at).toBeInstanceOf(Date);
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'products',
        'admins',
        'orders',
        'order_items',
        'stock_movements',
        'payment_events',
        'schema_migrations',
      ]),
    );
  });

  it('é idempotente: rodar de novo não reaplica nada', async () => {
    await runMigrations(pool, migrationsDir, silentLogger);
    const again = await runMigrations(pool, migrationsDir, silentLogger);
    expect(again).toEqual([]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(1);
  });

  it('execuções simultâneas aplicam a migração uma única vez (advisory lock)', async () => {
    const results = await Promise.all([
      runMigrations(pool, migrationsDir, silentLogger),
      runMigrations(pool, migrationsDir, silentLogger),
      runMigrations(pool, migrationsDir, silentLogger),
    ]);
    expect(results.flat()).toEqual(['001_init.sql']);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(1);
  });

  describe('com diretório temporário', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'bancada-migrations-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('aplica em ordem lexicográfica e ignora arquivos que não são .sql', async () => {
      writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (id INT);');
      writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id INT);');
      writeFileSync(join(dir, 'LEIAME.md'), 'não é migração');
      const applied = await runMigrations(pool, dir, silentLogger);
      expect(applied).toEqual(['001_a.sql', '002_b.sql']);
    });

    it('migração com erro faz ROLLBACK só dela, não registra e interrompe', async () => {
      writeFileSync(join(dir, '001_ok.sql'), 'CREATE TABLE ok (id INT);');
      writeFileSync(
        join(dir, '002_ruim.sql'),
        'CREATE TABLE parcial (id INT); SELECT coluna_que_nao_existe FROM ok;',
      );
      writeFileSync(join(dir, '003_depois.sql'), 'CREATE TABLE depois (id INT);');

      await expect(runMigrations(pool, dir, silentLogger)).rejects.toThrow();

      const versions = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
      expect(versions.rows.map((r) => r.version)).toEqual(['001_ok.sql']);
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const names = tables.rows.map((r) => r.table_name);
      expect(names).toContain('ok');
      expect(names).not.toContain('parcial');
      expect(names).not.toContain('depois');
    });

    it('depois de uma falha, o lock é liberado e uma nova execução funciona', async () => {
      writeFileSync(join(dir, '001_ruim.sql'), 'SELECT x FROM y;');
      await expect(runMigrations(pool, dir, silentLogger)).rejects.toThrow();
      const locks = await pool.query(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`,
      );
      expect(locks.rows[0].n).toBe(0);
      writeFileSync(join(dir, '001_ruim.sql'), 'CREATE TABLE corrigida (id INT);');
      await expect(runMigrations(pool, dir, silentLogger)).resolves.toEqual(['001_ruim.sql']);
    });
  });
});

describe('banco de teste (globalSetup)', () => {
  it('já está migrado e o runner não reaplica nada', async () => {
    const pool = createPool(testDatabaseUrl());
    try {
      await expect(runMigrations(pool, migrationsDir, silentLogger)).resolves.toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
