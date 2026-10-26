import type { StockMovement, StockMovementReason } from '@bancada/contracts';
import type { Db } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';

const PG_CHECK_VIOLATION = '23514';
const STOCK_CONSTRAINT = 'products_stock_nonnegative';

// Lançado quando o movimento deixaria o estoque negativo. Os services traduzem
// (OUT_OF_STOCK no pedido, INVALID_STOCK_ADJUSTMENT no ajuste do admin).
export class InsufficientStockError extends Error {
  constructor(
    readonly productId: string,
    readonly delta: number,
  ) {
    super(`Estoque insuficiente para o produto ${productId} (delta ${delta})`);
    this.name = 'InsufficientStockError';
  }
}

export interface StockMovementInput {
  productId: string;
  delta: number;
  reason: StockMovementReason;
  orderId?: string;
  adminId?: string;
  note?: string;
}

interface StockMovementRow {
  id: string;
  product_id: string;
  delta: number;
  reason: StockMovementReason;
  order_id: string | null;
  admin_id: string | null;
  note: string | null;
  stock_after: number;
  created_at: Date;
}

function toMovement(row: StockMovementRow): StockMovement {
  return {
    id: Number(row.id),
    productId: row.product_id,
    delta: row.delta,
    reason: row.reason,
    orderId: row.order_id,
    adminId: row.admin_id,
    note: row.note,
    stockAfter: row.stock_after,
    createdAt: row.created_at.toISOString(),
  };
}

function isStockConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === PG_CHECK_VIOLATION &&
    'constraint' in err &&
    err.constraint === STOCK_CONSTRAINT
  );
}

// ÚNICO ponto que altera products.stock. UPDATE + INSERT num só statement: é atômico
// mesmo com um Pool, e dentro da transação do chamador quando recebe um PoolClient.
export async function applyStockMovement(
  db: Db,
  { productId, delta, reason, orderId, adminId, note }: StockMovementInput,
): Promise<StockMovement> {
  try {
    const { rows } = await db.query<StockMovementRow>(
      `WITH updated AS (
         UPDATE products SET stock = stock + $2, updated_at = now()
         WHERE id = $1
         RETURNING id, stock
       )
       INSERT INTO stock_movements (product_id, delta, reason, order_id, admin_id, note, stock_after)
       SELECT id, $2, $3, $4, $5, $6, stock FROM updated
       RETURNING id, product_id, delta, reason, order_id, admin_id, note, stock_after, created_at`,
      [productId, delta, reason, orderId ?? null, adminId ?? null, note ?? null],
    );
    const row = rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Produto não encontrado');
    return toMovement(row);
  } catch (err) {
    if (isStockConstraintViolation(err)) throw new InsufficientStockError(productId, delta);
    throw err;
  }
}

export async function listMovements(
  db: Db,
  productId: string,
  limit: number,
): Promise<StockMovement[]> {
  const { rows } = await db.query<StockMovementRow>(
    `SELECT id, product_id, delta, reason, order_id, admin_id, note, stock_after, created_at
     FROM stock_movements
     WHERE product_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [productId, limit],
  );
  return rows.map(toMovement);
}
