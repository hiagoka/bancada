import pg from 'pg';

export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // Erro de rede entre queries não pode derrubar o processo; a query seguinte falha e dispara o ROLLBACK.
  const onClientError = (): void => {};
  client.on('error', onClientError);
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa; mas a conexão fica suspeita (transação possivelmente
      // aberta, segurando locks): ela é descartada em vez de voltar ao pool.
      discard = true;
    }
    throw err;
  } finally {
    client.off('error', onClientError);
    client.release(discard);
  }
}
