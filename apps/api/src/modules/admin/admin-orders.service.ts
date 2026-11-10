import {
  ADMIN_ORDERS_PAGE_SIZE,
  type AdminOrdersPage,
  type AdminOrdersQuery,
  type Order,
} from '@bancada/contracts';
import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { isCancellable } from '../orders/order-status.js';
import { toAdminOrder } from '../orders/orders.mapper.js';
import {
  findOrderByIdWithoutPix,
  listItemsByProduct,
  listOrdersPage,
  lockOrderForUpdate,
  markOrderCancelled,
} from '../orders/orders.repository.js';
import { applyStockMovement } from '../stock/stock.repository.js';

export interface AdminOrdersServiceDeps {
  pool: Pool;
  // Relógio injetável (testes). Padrão: agora.
  now?: () => Date;
}

export class AdminOrdersService {
  constructor(private readonly deps: AdminOrdersServiceDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  async list(query: AdminOrdersQuery): Promise<AdminOrdersPage> {
    const { orders, total } = await listOrdersPage(this.deps.pool, {
      status: query.status,
      limit: ADMIN_ORDERS_PAGE_SIZE,
      offset: (query.page - 1) * ADMIN_ORDERS_PAGE_SIZE,
    });
    const now = this.now();
    return {
      items: orders.map((order) => toAdminOrder(order, now)),
      page: query.page,
      pageSize: ADMIN_ORDERS_PAGE_SIZE,
      total,
    };
  }

  // 8.8: BEGIN; SELECT ... FOR UPDATE no pedido; só cancela PENDING com mais de 30 min. Devolve
  // o estoque item a item em ordem de product_id (D18, mesma ordem dos locks da criação de pedido).
  async cancel(orderId: string, adminId: string): Promise<Order> {
    await withTransaction(this.deps.pool, async (client) => {
      const order = await lockOrderForUpdate(client, orderId);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Pedido não encontrado');
      if (!isCancellable(order, this.now())) {
        throw new AppError(
          409,
          'ORDER_NOT_CANCELLABLE',
          'Só é possível cancelar pedidos pendentes criados há mais de 30 minutos',
        );
      }

      await markOrderCancelled(client, orderId);
      for (const item of await listItemsByProduct(client, orderId)) {
        await applyStockMovement(client, {
          productId: item.productId,
          delta: item.quantity,
          reason: 'order_cancelled',
          orderId,
          adminId,
        });
      }
    });
    const cancelled = await findOrderByIdWithoutPix(this.deps.pool, orderId);
    return toAdminOrder(cancelled!, this.now());
  }
}
