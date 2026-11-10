import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { createScratchDb, type ScratchDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const migrationsDir = resolve(__dirname, '../src/db/migrations');

// Pasta temporária só com UMA das migrações reais (para testar a evolução de um banco existente).
const tempDirs: string[] = [];
function dirWithOnly(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bancada-migrations-'));
  copyFileSync(join(migrationsDir, file), join(dir, file));
  tempDirs.push(dir);
  return dir;
}

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
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('aplica as migrações em ordem e registra cada uma em schema_migrations', async () => {
    const applied = await runMigrations(pool, migrationsDir, silentLogger);
    expect(applied).toEqual(['001_init.sql', '002_pix.sql']);
    const { rows } = await pool.query(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual(['001_init.sql', '002_pix.sql']);
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
    expect(rows[0].n).toBe(2);
  });

  it('execuções simultâneas aplicam a migração uma única vez (advisory lock)', async () => {
    const results = await Promise.all([
      runMigrations(pool, migrationsDir, silentLogger),
      runMigrations(pool, migrationsDir, silentLogger),
      runMigrations(pool, migrationsDir, silentLogger),
    ]);
    expect(results.flat()).toEqual(['001_init.sql', '002_pix.sql']);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(2);
  });

  describe('002_pix.sql (AbacatePay, D34)', () => {
    const columnsOf = async (table: string) => {
      const { rows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      return new Map(rows.map((r) => [r.column_name, r]));
    };

    it('orders ganha pix_code, pix_qr_image e pix_expires_at, todas anuláveis', async () => {
      await runMigrations(pool, migrationsDir, silentLogger);
      const columns = await columnsOf('orders');
      expect(columns.get('pix_code')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
      expect(columns.get('pix_qr_image')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
      expect(columns.get('pix_expires_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
      });
    });

    it('payment_events.amount_cents passa a aceitar NULL (a AbacatePay não informa o valor pago)', async () => {
      await runMigrations(pool, migrationsDir, silentLogger);
      expect((await columnsOf('payment_events')).get('amount_cents')?.is_nullable).toBe('YES');
    });

    it('cria o índice parcial de checkout_id (o webhook acha o pedido por ele)', async () => {
      await runMigrations(pool, migrationsDir, silentLogger);
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'orders_checkout_id_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.indexdef).toContain('checkout_id');
      expect(rows[0]!.indexdef).toContain('WHERE');
    });

    it('pedidos que já existiam continuam intactos, com os campos Pix nulos', async () => {
      await runMigrations(pool, dirWithOnly('001_init.sql'), silentLogger);
      await pool.query(
        `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email,
                             total_cents, payment_provider, checkout_id, checkout_url)
         VALUES ('k1', 'h', 'Ana', 'ana@example.com', 1000, 'fake', 'c1', 'http://x')`,
      );
      await pool.query(
        `INSERT INTO payment_events (provider, payment_id, status, amount_cents)
         VALUES ('fake', 'p1', 'approved', 1000)`,
      );
      await expect(runMigrations(pool, migrationsDir, silentLogger)).resolves.toEqual([
        '002_pix.sql',
      ]);
      const { rows } = await pool.query(
        'SELECT checkout_id, checkout_url, pix_code, pix_qr_image, pix_expires_at FROM orders',
      );
      expect(rows).toEqual([
        {
          checkout_id: 'c1',
          checkout_url: 'http://x',
          pix_code: null,
          pix_qr_image: null,
          pix_expires_at: null,
        },
      ]);
      const events = await pool.query('SELECT amount_cents FROM payment_events');
      expect(events.rows).toEqual([{ amount_cents: 1000 }]);
    });
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
