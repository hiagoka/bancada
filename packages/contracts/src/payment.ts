import { z } from 'zod';
import { MAX_INT4 } from './limits.js';

// Status de pagamento do Mercado Pago que o sistema reconhece.
export const paymentStatusSchema = z.enum(
  [
    'approved',
    'pending',
    'in_process',
    'authorized',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
    'in_mediation',
  ],
  { error: 'Status de pagamento inválido' },
);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

// POST /dev/payments/simulate (só existe com PAYMENT_PROVIDER=fake).
export const simulatePaymentInputSchema = z.object({
  orderId: z.uuid({ error: 'Pedido inválido' }),
  status: paymentStatusSchema,
  // Padrão no servidor: o total do pedido.
  amountCents: z
    .number({ error: 'O valor deve ser um número' })
    .int({ error: 'O valor deve ser um número inteiro de centavos' })
    .positive({ error: 'O valor deve ser maior que zero' })
    .max(MAX_INT4, { error: 'O valor é alto demais' })
    .optional(),
  // Padrão no servidor: um id gerado.
  paymentId: z
    .string({ error: 'O id do pagamento deve ser um texto' })
    .trim()
    .min(1, { error: 'O id do pagamento não pode ser vazio' })
    .max(64, { error: 'O id do pagamento deve ter no máximo 64 caracteres' })
    .optional(),
});
export type SimulatePaymentInput = z.infer<typeof simulatePaymentInputSchema>;
