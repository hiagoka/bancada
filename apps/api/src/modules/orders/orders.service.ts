import { createHash } from 'node:crypto';
import { MAX_INT4, MAX_ORDER_ITEM_QUANTITY, type CreateOrderInput } from '@bancada/contracts';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { GatewayError, type PaymentGateway } from '../payments/payment-gateway.js';
import { InsufficientStockError, applyStockMovement } from '../stock/stock.repository.js';
import {
  findOrderById,
  findOrderByIdempotencyKey,
  insertOrder,
  insertOrderItem,
  lockActiveProducts,
  setCheckoutIfMissing,
  type OrderItemRecord,
  type OrderWithItems,
} from './orders.repository.js';

export interface OrdersServiceDeps {
  pool: Pool;
  gateway: PaymentGateway;
  logger: Logger;
  // Relógio injetável (testes).
  now?: () => Date;
}

// A cobrança no provedor expira 30 minutos depois da criação do pedido (D14). É a mesma janela do
// cancelamento manual (8.8: created_at < agora - 30 min), então um pedido que o admin pode
// cancelar nunca está mais pagável no provedor.
const CHECKOUT_TTL_MS = 30 * 60 * 1000;

export interface CreateOrderResult {
  order: OrderWithItems;
  // true = pedido novo (201); false = replay da mesma Idempotency-Key (200).
  created: boolean;
}

interface NormalizedItem {
  productId: string;
  quantity: number;
}

// Lançado dentro da transação para forçar o ROLLBACK quando a chave já tem pedido.
class IdempotentReplay extends Error {
  constructor(readonly order: OrderWithItems) {
    super('Idempotency-Key já usada com o mesmo pedido');
    this.name = 'IdempotentReplay';
  }
}

function validationError(message: string, path: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos', [{ path, message }]);
}

// Soma produtos repetidos e ordena por productId (ordem canônica, a mesma dos locks).
export function normalizeItems(items: CreateOrderInput['items']): NormalizedItem[] {
  const merged = new Map<string, number>();
  for (const item of items) {
    const productId = item.productId.toLowerCase();
    merged.set(productId, (merged.get(productId) ?? 0) + item.quantity);
  }
  return [...merged.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, quantity]) => {
      if (quantity > MAX_ORDER_ITEM_QUANTITY) {
        throw validationError(`A quantidade máxima por item é ${MAX_ORDER_ITEM_QUANTITY}`, 'items');
      }
      return { productId, quantity };
    });
}

// sha256 de um JSON canônico: customer normalizado + itens normalizados.
export function hashRequest(
  customer: CreateOrderInput['customer'],
  items: NormalizedItem[],
): string {
  const canonical = JSON.stringify({
    customer: { name: customer.name.trim(), email: customer.email.trim().toLowerCase() },
    items: items.map(({ productId, quantity }) => ({ productId, quantity })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class OrdersService {
  constructor(private readonly deps: OrdersServiceDeps) {}

  async getOrder(id: string): Promise<OrderWithItems | null> {
    return findOrderById(this.deps.pool, id);
  }

  // Fluxo 8.1. Refinamento da ordem: logo após travar os produtos (e ANTES de validar o
  // estoque) a Idempotency-Key é consultada de novo dentro da transação. Sem isso, uma
  // requisição repetida simultânea esperaria o lock, encontraria o estoque já reservado pela
  // primeira e responderia OUT_OF_STOCK em vez de replay.
  async createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<CreateOrderResult> {
    const items = normalizeItems(input.items);
    const requestHash = hashRequest(input.customer, items);

    const existing = await findOrderByIdempotencyKey(this.deps.pool, idempotencyKey);
    if (existing) {
      const order = await this.ensureCheckout(this.replayOf(existing, requestHash));
      return { order, created: false };
    }

    try {
      const order = await withTransaction(this.deps.pool, async (client) => {
        const ids = items.map((i) => i.productId);
        const locked = await lockActiveProducts(client, ids);

        const raced = await findOrderByIdempotencyKey(client, idempotencyKey);
        if (raced) throw new IdempotentReplay(this.replayOf(raced, requestHash));

        const byId = new Map(locked.map((p) => [p.id, p]));
        const missing = ids.filter((id) => !byId.has(id));
        if (missing.length > 0) {
          throw new AppError(
            422,
            'PRODUCT_UNAVAILABLE',
            'Um ou mais produtos estão indisponíveis',
            missing.map((productId) => ({ productId })),
          );
        }

        const short = items
          .map((item) => ({
            productId: item.productId,
            requested: item.quantity,
            available: byId.get(item.productId)!.stock,
          }))
          .filter((i) => i.requested > i.available);
        if (short.length > 0) {
          throw new AppError(
            409,
            'OUT_OF_STOCK',
            'Estoque insuficiente para um ou mais itens',
            short,
          );
        }

        // Preço SEMPRE do banco. A soma para antes de passar do int4 (total_cents), então
        // nunca perde precisão nem estoura no INSERT.
        const orderItems: OrderItemRecord[] = [];
        let totalCents = 0;
        for (const item of items) {
          const product = byId.get(item.productId)!;
          totalCents += product.priceCents * item.quantity;
          if (totalCents > MAX_INT4) {
            throw validationError('O valor total do pedido excede o limite permitido', 'items');
          }
          orderItems.push({
            productId: product.id,
            productName: product.name,
            unitPriceCents: product.priceCents,
            quantity: item.quantity,
          });
        }

        const orderId = await insertOrder(client, {
          idempotencyKey,
          requestHash,
          customerName: input.customer.name.trim(),
          customerEmail: input.customer.email.trim().toLowerCase(),
          totalCents,
          paymentProvider: this.deps.gateway.name,
        });
        if (orderId === null) {
          // Rede de segurança: outra requisição gravou a chave entre a reconsulta e o INSERT.
          const winner = await findOrderByIdempotencyKey(client, idempotencyKey);
          if (!winner) throw new Error('Pedido concorrente não encontrado após ON CONFLICT');
          throw new IdempotentReplay(this.replayOf(winner, requestHash));
        }

        for (const item of orderItems) {
          await insertOrderItem(client, orderId, item);
        }
        for (const item of orderItems) {
          try {
            await applyStockMovement(client, {
              productId: item.productId,
              delta: -item.quantity,
              reason: 'order',
              orderId,
            });
          } catch (err) {
            if (err instanceof InsufficientStockError) {
              throw new AppError(
                409,
                'OUT_OF_STOCK',
                'Estoque insuficiente para um ou mais itens',
                [
                  {
                    productId: item.productId,
                    requested: item.quantity,
                    available: byId.get(item.productId)!.stock,
                  },
                ],
              );
            }
            throw err;
          }
        }

        const created = await findOrderById(client, orderId);
        if (!created) throw new Error('Pedido recém-criado não encontrado');
        return created;
      });
      // FORA da transação: um gateway lento não segura os locks dos produtos.
      return { order: await this.ensureCheckout(order), created: true };
    } catch (err) {
      if (err instanceof IdempotentReplay) {
        return { order: await this.ensureCheckout(err.order), created: false };
      }
      throw err;
    }
  }

  // Passo 8: garante o checkout de um pedido PENDING. Pedido que já tem checkout, ou que não
  // está mais PENDING, volta como está (o gateway não é chamado). Se o gateway falhar, o pedido
  // e a reserva de estoque continuam salvos e o retry com a mesma chave conclui o checkout.
  private async ensureCheckout(order: OrderWithItems): Promise<OrderWithItems> {
    if (order.status !== 'PENDING' || order.checkoutUrl) return order;

    const unavailable = (): AppError =>
      new AppError(
        502,
        'CHECKOUT_UNAVAILABLE',
        'Não foi possível iniciar o pagamento. Tente novamente com a mesma chave.',
        { orderId: order.id },
      );
    // Retry com a mesma chave nunca mais funciona: o web precisa gerar uma chave nova.
    const expired = (): AppError =>
      new AppError(
        502,
        'CHECKOUT_UNAVAILABLE',
        'O tempo para pagar este pedido acabou. Faça um novo pedido.',
        { orderId: order.id, reason: 'expired' },
      );

    const expiresAt = new Date(order.createdAt.getTime() + CHECKOUT_TTL_MS);
    const now = (this.deps.now ?? (() => new Date()))();
    if (expiresAt.getTime() <= now.getTime()) {
      this.deps.logger.warn({ orderId: order.id }, 'Checkout não refeito: pedido já expirou');
      throw expired();
    }

    try {
      const checkout = await this.deps.gateway.createCheckout({
        orderId: order.id,
        items: order.items.map((i) => ({
          name: i.productName,
          unitPriceCents: i.unitPriceCents,
          quantity: i.quantity,
        })),
        totalCents: order.totalCents,
        expiresAt,
      });
      await setCheckoutIfMissing(
        this.deps.pool,
        order.id,
        checkout.checkoutId,
        checkout.checkoutUrl,
      );
    } catch (err) {
      // GatewayError já tem mensagem sem credenciais; qualquer outro erro (ex.: banco) é nosso
      // e não carrega o token, então vai completo, com stack.
      this.deps.logger.error(
        {
          orderId: order.id,
          provider: this.deps.gateway.name,
          ...(err instanceof GatewayError ? { reason: err.message } : { err }),
        },
        'Falha ao criar o checkout',
      );
      throw unavailable();
    }

    // Relê: se outra requisição gravou o checkout primeiro, vale o que está no banco.
    return (await findOrderById(this.deps.pool, order.id)) ?? order;
  }

  // Mesma chave com o mesmo corpo = replay; com corpo diferente = conflito.
  private replayOf(order: OrderWithItems, requestHash: string): OrderWithItems {
    if (order.requestHash !== requestHash) {
      throw new AppError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Esta Idempotency-Key já foi usada com outro pedido',
      );
    }
    return order;
  }
}
