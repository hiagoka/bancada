import { AppError } from '../src/shared/errors.js';
import { createPool, withTransaction } from '../src/db/pool.js';
import {
  InsufficientStockError,
  applyStockMovement,
  listMovements,
} from '../src/modules/stock/stock.repository.js';
import { insertAdmin, insertOrder, insertProduct, resetDb } from './db-helpers.js';
import { testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return rows[0].stock;
}

async function sumDeltas(productId: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(delta), 0)::int AS total FROM stock_movements WHERE product_id = $1',
    [productId],
  );
  return rows[0].total;
}

async function countMovements(productId: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1',
    [productId],
  );
  return rows[0].n;
}

describe('applyStockMovement', () => {
  it('atualiza o estoque e grava o movimento com stock_after correto', async () => {
    const productId = await insertProduct(pool, { stock: 0 });
    const adminId = await insertAdmin(pool);
    const movement = await applyStockMovement(pool, {
      productId,
      delta: 5,
      reason: 'restock',
      adminId,
      note: 'reposição',
    });
    expect(movement).toMatchObject({
      productId,
      delta: 5,
      reason: 'restock',
      orderId: null,
      adminId,
      note: 'reposição',
      stockAfter: 5,
    });
    expect(typeof movement.id).toBe('number');
    expect(new Date(movement.createdAt).toString()).not.toBe('Invalid Date');
    expect(await stockOf(productId)).toBe(5);
  });

  it('grava order_id e stock_after em saídas sucessivas', async () => {
    const productId = await insertProduct(pool, { stock: 10 });
    const orderId = await insertOrder(pool);
    const first = await applyStockMovement(pool, {
      productId,
      delta: -3,
      reason: 'order',
      orderId,
    });
    const second = await applyStockMovement(pool, {
      productId,
      delta: -2,
      reason: 'order',
      orderId,
    });
    expect([first.stockAfter, second.stockAfter]).toEqual([7, 5]);
    expect(first.orderId).toBe(orderId);
    expect(await stockOf(productId)).toBe(5);
  });

  it('deixar o estoque negativo lança InsufficientStockError e não altera nada', async () => {
    const productId = await insertProduct(pool, { stock: 2 });
    await expect(
      applyStockMovement(pool, { productId, delta: -3, reason: 'order' }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stockOf(productId)).toBe(2);
    expect(await countMovements(productId)).toBe(0);
  });

  it('aceita levar o estoque exatamente a zero', async () => {
    const productId = await insertProduct(pool, { stock: 2 });
    const movement = await applyStockMovement(pool, { productId, delta: -2, reason: 'adjustment' });
    expect(movement.stockAfter).toBe(0);
  });

  it('produto inexistente: AppError 404 NOT_FOUND', async () => {
    const error = await applyStockMovement(pool, {
      productId: '00000000-0000-0000-0000-000000000000',
      delta: 1,
      reason: 'restock',
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000_000])(
    'delta inválido (%p): AppError 400 VALIDATION_ERROR antes da query e nada muda',
    async (delta) => {
      const productId = await insertProduct(pool, { stock: 4 });
      const error = await applyStockMovement(pool, {
        productId,
        delta,
        reason: 'adjustment',
      }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(await stockOf(productId)).toBe(4);
      expect(await countMovements(productId)).toBe(0);
    },
  );

  it.each(['abc', '', '123'])(
    'productId que não é UUID (%p): AppError 400, não erro cru do pg',
    async (productId) => {
      const error = await applyStockMovement(pool, {
        productId,
        delta: 1,
        reason: 'restock',
      }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    },
  );

  it('orderId e adminId que não são UUID também dão AppError 400', async () => {
    const productId = await insertProduct(pool, { stock: 4 });
    for (const extra of [{ orderId: 'x' }, { adminId: 'y' }]) {
      const error = await applyStockMovement(pool, {
        productId,
        delta: 1,
        reason: 'restock',
        ...extra,
      }).catch((err: unknown) => err);
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
  });

  it('participa da transação do chamador: ROLLBACK desfaz estoque e movimento', async () => {
    const productId = await insertProduct(pool, { stock: 5 });
    await expect(
      withTransaction(pool, async (client) => {
        await applyStockMovement(client, { productId, delta: -4, reason: 'order' });
        throw new Error('abortar');
      }),
    ).rejects.toThrow('abortar');
    expect(await stockOf(productId)).toBe(5);
    expect(await countMovements(productId)).toBe(0);
  });

  it('COMMIT da transação do chamador persiste os dois', async () => {
    const productId = await insertProduct(pool, { stock: 5 });
    await withTransaction(pool, async (client) => {
      await applyStockMovement(client, { productId, delta: -4, reason: 'order' });
    });
    expect(await stockOf(productId)).toBe(1);
    expect(await countMovements(productId)).toBe(1);
  });

  it('invariante: estoque == soma dos movimentos após uma sequência', async () => {
    const productId = await insertProduct(pool, { stock: 0 });
    const deltas = [10, -3, 5, -7, 2, -1, 20, -15];
    for (const delta of deltas) {
      await applyStockMovement(pool, {
        productId,
        delta,
        reason: delta > 0 ? 'restock' : 'adjustment',
      });
    }
    const expected = deltas.reduce((a, b) => a + b, 0);
    expect(await stockOf(productId)).toBe(expected);
    expect(await sumDeltas(productId)).toBe(expected);
  });

  it('20 movimentos concorrentes de -1 com estoque 10: exatamente 10 sucessos', async () => {
    const productId = await insertProduct(pool, { stock: 0 });
    await applyStockMovement(pool, { productId, delta: 10, reason: 'initial' });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        applyStockMovement(pool, { productId, delta: -1, reason: 'order' }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(10);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(InsufficientStockError);
    }
    expect(await stockOf(productId)).toBe(0);
    expect(await sumDeltas(productId)).toBe(0);
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(delta), 0)::int AS total FROM stock_movements
       WHERE product_id = $1 AND reason = 'order'`,
      [productId],
    );
    expect(rows[0].total).toBe(-10);
  });
});

describe('listMovements', () => {
  it('devolve os mais recentes primeiro e respeita o limite', async () => {
    const productId = await insertProduct(pool, { stock: 0 });
    for (const delta of [1, 2, 3, 4]) {
      await applyStockMovement(pool, { productId, delta, reason: 'restock' });
    }
    const all = await listMovements(pool, productId, 20);
    expect(all.map((m) => m.delta)).toEqual([4, 3, 2, 1]);
    const two = await listMovements(pool, productId, 2);
    expect(two.map((m) => m.delta)).toEqual([4, 3]);
  });

  it('devolve vazio para produto sem movimentos', async () => {
    const productId = await insertProduct(pool);
    await expect(listMovements(pool, productId, 20)).resolves.toEqual([]);
  });
});
