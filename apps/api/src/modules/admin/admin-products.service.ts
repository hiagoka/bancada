import {
  MAX_INT4,
  type AdminProduct,
  type AdminProductDetail,
  type AdminProductInput,
  type AdminProductUpdate,
  type AdminProductsQuery,
  type StockAdjustment,
  type StockAdjustmentResult,
} from '@bancada/contracts';
import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { slugify } from '../../shared/slug.js';
import { toAdminProduct } from '../products/products.mapper.js';
import {
  findProductById,
  insertProduct,
  listProducts,
  lockProductForUpdate,
  updateProduct,
} from '../products/products.repository.js';
import {
  InsufficientStockError,
  applyStockMovement,
  listMovements,
} from '../stock/stock.repository.js';
import type { StorageService } from '../storage/storage.service.js';

export const DETAIL_MOVEMENTS_LIMIT = 20;

export interface AdminProductsServiceDeps {
  pool: Pool;
  storage: StorageService;
}

const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Produto não encontrado');

export class AdminProductsService {
  constructor(private readonly deps: AdminProductsServiceDeps) {}

  async list(query: AdminProductsQuery): Promise<AdminProduct[]> {
    const records = await listProducts(this.deps.pool, query);
    return records.map((r) => toAdminProduct(r, this.deps.storage));
  }

  async get(id: string): Promise<AdminProductDetail> {
    const product = await findProductById(this.deps.pool, id);
    if (!product) throw notFound();
    const movements = await listMovements(this.deps.pool, id, DETAIL_MOVEMENTS_LIMIT);
    return { ...toAdminProduct(product, this.deps.storage), movements };
  }

  // 8.6: INSERT com stock 0 e, se initialStock > 0, movimento 'initial' com admin_id, numa
  // transação. O slug vem do nome e é imutável depois.
  async create(input: AdminProductInput, adminId: string): Promise<AdminProduct> {
    const slug = slugify(input.name);
    if (!slug) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos', [
        { path: 'name', message: 'O nome deve ter ao menos uma letra ou número' },
      ]);
    }
    const created = await withTransaction(this.deps.pool, async (client) => {
      const productId = await insertProduct(client, {
        slug,
        name: input.name,
        description: input.description,
        category: input.category,
        priceCents: input.priceCents,
        imageKey: input.imageKey ?? null,
      });
      if (productId === null) {
        throw new AppError(409, 'SLUG_TAKEN', 'Já existe um produto com este nome');
      }
      if (input.initialStock > 0) {
        await applyStockMovement(client, {
          productId,
          delta: input.initialStock,
          reason: 'initial',
          adminId,
        });
      }
      return findProductById(client, productId);
    });
    return toAdminProduct(created!, this.deps.storage);
  }

  // Altera dados e preço. NUNCA toca em estoque nem em slug. Pedidos existentes não mudam
  // (snapshot em order_items).
  async update(id: string, patch: AdminProductUpdate): Promise<AdminProduct> {
    const updated = await updateProduct(this.deps.pool, id, patch);
    if (!updated) throw notFound();
    return toAdminProduct(updated, this.deps.storage);
  }

  // BEGIN; SELECT ... FOR UPDATE (o MESMO lock do fluxo de pedido); se ficaria negativo: 409 e
  // nada muda; senão applyStockMovement. Produto inativo também pode ser ajustado.
  async adjustStock(
    id: string,
    adjustment: StockAdjustment,
    adminId: string,
  ): Promise<StockAdjustmentResult> {
    const { movement, product } = await withTransaction(this.deps.pool, async (client) => {
      const locked = await lockProductForUpdate(client, id);
      if (!locked) throw notFound();

      const resulting = locked.stock + adjustment.delta;
      if (resulting < 0) {
        throw new AppError(
          409,
          'INVALID_STOCK_ADJUSTMENT',
          'Ajuste inválido: o estoque ficaria negativo',
          { available: locked.stock, delta: adjustment.delta },
        );
      }
      if (resulting > MAX_INT4) {
        throw new AppError(
          409,
          'INVALID_STOCK_ADJUSTMENT',
          'Ajuste inválido: o estoque ultrapassaria o limite permitido',
          { available: locked.stock, delta: adjustment.delta },
        );
      }

      try {
        const movement = await applyStockMovement(client, {
          productId: id,
          delta: adjustment.delta,
          reason: adjustment.reason,
          adminId,
          note: adjustment.note,
        });
        return { movement, product: await findProductById(client, id) };
      } catch (err) {
        // Rede de segurança: a constraint stock >= 0 é a última barreira.
        if (err instanceof InsufficientStockError) {
          throw new AppError(
            409,
            'INVALID_STOCK_ADJUSTMENT',
            'Ajuste inválido: o estoque ficaria negativo',
            { available: locked.stock, delta: adjustment.delta },
          );
        }
        throw err;
      }
    });
    return { product: toAdminProduct(product!, this.deps.storage), movement };
  }
}
