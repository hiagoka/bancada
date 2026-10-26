import { createOrderInputSchema, publicOrderSchema, type PublicOrder } from '@bancada/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import type { OrderWithItems } from './orders.repository.js';
import type { OrdersService } from './orders.service.js';

const idempotencyKeySchema = z
  .string({ error: 'Informe o cabeçalho Idempotency-Key' })
  .trim()
  .min(1, { error: 'O cabeçalho Idempotency-Key não pode ser vazio' })
  .max(255, { error: 'O cabeçalho Idempotency-Key deve ter no máximo 255 caracteres' });

const idSchema = z.uuid();

// Resposta pública: SEM dados do cliente. checkoutUrl só enquanto o pedido está PENDING.
export function toPublicOrder(order: OrderWithItems): PublicOrder {
  const parsed = publicOrderSchema.safeParse({
    id: order.id,
    status: order.status,
    items: order.items,
    totalCents: order.totalCents,
    checkoutUrl: order.status === 'PENDING' ? order.checkoutUrl : null,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
  });
  // Dado do banco fora do contrato é bug nosso (500), não erro de validação do cliente.
  if (!parsed.success) throw new Error('Pedido fora do contrato público', { cause: parsed.error });
  return parsed.data;
}

export interface OrdersRouterDeps {
  ordersService: OrdersService;
}

export function createOrdersRouter({ ordersService }: OrdersRouterDeps): Router {
  const router = Router();

  router.post('/orders', async (req, res) => {
    const key = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
    if (!key.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos', [
        { path: 'Idempotency-Key', message: key.error.issues[0]!.message },
      ]);
    }
    const input = createOrderInputSchema.parse(req.body);
    const { order, created } = await ordersService.createOrder(input, key.data);
    res.status(created ? 201 : 200).json({ data: toPublicOrder(order) });
  });

  router.get('/orders/:id', async (req, res) => {
    // Id que não é UUID não existe: 404 sem passar pelo banco (evita o erro 22P02 do pg).
    const id = idSchema.safeParse(req.params.id);
    const order = id.success ? await ordersService.getOrder(id.data) : null;
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Pedido não encontrado');
    res.json({ data: toPublicOrder(order) });
  });

  return router;
}
