import { stockAdjustmentSchema, type StockMovementReason } from '@bancada/contracts';
import { z } from 'zod';
import { ApiError, NetworkError } from '../../api/http';

const shape = stockAdjustmentSchema.shape;

// Ajuste digitado com sinal ("10", "+10", "-3") -> inteiro. A regra de zero, o teto e as mensagens
// (PT-BR) são as do contracts.
const deltaField = z
  .string({ error: 'Informe a quantidade do ajuste' })
  .trim()
  .min(1, { error: 'Informe a quantidade do ajuste' })
  .regex(/^[+-]?\d+$/, {
    error: 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)',
  })
  .transform(Number)
  .pipe(shape.delta);

export const stockFormSchema = z.object({
  delta: deltaField,
  reason: shape.reason,
  note: shape.note,
});
export type StockFormInput = z.input<typeof stockFormSchema>;
export type StockFormValues = z.output<typeof stockFormSchema>;

export const MOVEMENT_REASON_LABEL: Record<StockMovementReason, string> = {
  initial: 'Estoque inicial',
  restock: 'Reposição',
  adjustment: 'Ajuste',
  order: 'Pedido',
  order_cancelled: 'Pedido cancelado',
};

// "+5" / "−3" (sinal de menos de verdade): o sinal aparece escrito, não só por cor.
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

export function describeStockError(error: unknown, currentStock: number): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_STOCK_ADJUSTMENT') {
      return `Esse ajuste deixaria o estoque negativo. O estoque atual é ${currentStock}; nada foi alterado.`;
    }
    if (error.status === 404) return 'Produto não encontrado. Ele pode ter sido removido.';
    if (error.code === 'VALIDATION_ERROR') return 'Confira os campos do ajuste e tente de novo.';
  }
  if (error instanceof NetworkError) {
    return 'A API está fora do ar. Verifique sua conexão e tente de novo.';
  }
  return 'Não foi possível ajustar o estoque. Tente de novo em instantes.';
}
