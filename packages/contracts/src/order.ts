import { z } from 'zod';
import { MAX_ORDER_ITEM_QUANTITY } from './limits.js';

export const orderStatusSchema = z.enum(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

const emailSchema = z
  .string({ error: 'Informe um e-mail válido' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido' }));

// Sem campo de preço: o preço sempre vem do banco.
export const createOrderInputSchema = z.object(
  {
    customer: z.object(
      {
        name: z
          .string({ error: 'Informe seu nome' })
          .trim()
          .min(1, { error: 'Informe seu nome' })
          .max(120, { error: 'O nome deve ter no máximo 120 caracteres' }),
        email: emailSchema,
      },
      { error: 'Informe os dados do cliente' },
    ),
    items: z
      .array(
        z.object(
          {
            productId: z.uuid({ error: 'Produto inválido' }),
            quantity: z
              .number({ error: 'Informe a quantidade' })
              .int({ error: 'A quantidade deve ser um número inteiro' })
              .positive({ error: 'A quantidade deve ser maior que zero' })
              .max(MAX_ORDER_ITEM_QUANTITY, {
                error: `A quantidade máxima por item é ${MAX_ORDER_ITEM_QUANTITY}`,
              }),
          },
          { error: 'Item inválido' },
        ),
        { error: 'Informe os itens do pedido' },
      )
      .min(1, { error: 'O pedido precisa ter ao menos um item' }),
  },
  { error: 'Corpo do pedido inválido' },
);
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export const orderItemSchema = z.object({
  productId: z.uuid(),
  productName: z.string(),
  unitPriceCents: z.number().int().positive(),
  quantity: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

// Resposta pública (GET /orders/:id): NUNCA contém dados do cliente.
export const publicOrderSchema = z.object({
  id: z.uuid(),
  status: orderStatusSchema,
  items: z.array(orderItemSchema),
  totalCents: z.number().int().positive(),
  checkoutUrl: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

// Completo, só para o admin (GET /admin/orders).
export const orderSchema = publicOrderSchema.extend({
  customer: z.object({
    name: z.string(),
    email: z.string(),
  }),
  cancellable: z.boolean(),
});
export type Order = z.infer<typeof orderSchema>;

export const ADMIN_ORDERS_PAGE_SIZE = 20;

// GET /admin/orders?status=&page=
export const adminOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  page: z.coerce
    .number({ error: 'A página deve ser um inteiro maior ou igual a 1' })
    .int({ error: 'A página deve ser um inteiro maior ou igual a 1' })
    .min(1, { error: 'A página deve ser um inteiro maior ou igual a 1' })
    .max(1_000_000, { error: 'A página deve ser um inteiro maior ou igual a 1' })
    .default(1),
});
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;

export const adminOrdersPageSchema = z.object({
  items: z.array(orderSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type AdminOrdersPage = z.infer<typeof adminOrdersPageSchema>;
