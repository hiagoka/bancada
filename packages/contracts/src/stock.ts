import { z } from 'zod';
import { MAX_INT4 } from './limits.js';

export const stockMovementReasonSchema = z.enum([
  'initial',
  'restock',
  'adjustment',
  'order',
  'order_cancelled',
]);
export type StockMovementReason = z.infer<typeof stockMovementReasonSchema>;

export const stockAdjustmentSchema = z.object({
  delta: z
    .number({ error: 'Informe a quantidade do ajuste' })
    .int({ error: 'A quantidade do ajuste deve ser um número inteiro' })
    .refine((n) => n !== 0, { error: 'A quantidade do ajuste não pode ser zero' })
    .min(-MAX_INT4, { error: 'A quantidade do ajuste é grande demais' })
    .max(MAX_INT4, { error: 'A quantidade do ajuste é grande demais' }),
  reason: z.enum(['restock', 'adjustment'], {
    error: 'Informe o motivo do ajuste (reposição ou ajuste)',
  }),
  note: z
    .string({ error: 'A observação deve ser um texto' })
    .trim()
    .max(500, { error: 'A observação deve ter no máximo 500 caracteres' })
    // Observação em branco vira "sem observação" (NULL no banco), não string vazia.
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});
export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;

export const stockMovementSchema = z.object({
  id: z.number().int(),
  productId: z.uuid(),
  delta: z.number().int(),
  reason: stockMovementReasonSchema,
  orderId: z.uuid().nullable(),
  adminId: z.uuid().nullable(),
  note: z.string().nullable(),
  stockAfter: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;
