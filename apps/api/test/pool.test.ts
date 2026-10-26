import { createPool, withTransaction } from '../src/db/pool.js';
import { testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());

beforeAll(async () => {
  await pool.query('DROP TABLE IF EXISTS t04_tx_probe');
  await pool.query('CREATE TABLE t04_tx_probe (n INT)');
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS t04_tx_probe');
  await pool.end();
});

describe('withTransaction', () => {
  it('faz COMMIT e devolve o resultado', async () => {
    const result = await withTransaction(pool, async (client) => {
      await client.query('INSERT INTO t04_tx_probe (n) VALUES ($1)', [1]);
      return 'ok';
    });
    expect(result).toBe('ok');
    const { rows } = await pool.query('SELECT n FROM t04_tx_probe WHERE n = 1');
    expect(rows).toHaveLength(1);
  });

  it('faz ROLLBACK, relança o erro e devolve a conexão ao pool', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query('INSERT INTO t04_tx_probe (n) VALUES ($1)', [2]);
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    const { rows } = await pool.query('SELECT n FROM t04_tx_probe WHERE n = 2');
    expect(rows).toHaveLength(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
