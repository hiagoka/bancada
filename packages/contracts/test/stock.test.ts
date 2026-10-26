import { stockAdjustmentSchema, stockMovementSchema } from '../src/index.js';
import { isoDate, messagesOf } from './fixtures.js';

describe('stockAdjustmentSchema', () => {
  it.each(['restock', 'adjustment'] as const)('aceita reason %s', (reason) => {
    expect(stockAdjustmentSchema.safeParse({ delta: 5, reason }).success).toBe(true);
  });

  it('aceita delta negativo e note opcional', () => {
    const parsed = stockAdjustmentSchema.parse({ delta: -2, reason: 'adjustment', note: 'quebra' });
    expect(parsed).toEqual({ delta: -2, reason: 'adjustment', note: 'quebra' });
  });

  it('note em branco vira ausente (NULL no banco)', () => {
    for (const note of ['', '   ']) {
      const parsed = stockAdjustmentSchema.parse({ delta: 1, reason: 'restock', note });
      expect(parsed.note).toBeUndefined();
    }
    expect(stockAdjustmentSchema.parse({ delta: 1, reason: 'restock', note: ' ok ' }).note).toBe(
      'ok',
    );
  });

  it('rejeita delta 0 com mensagem em PT-BR', () => {
    const result = stockAdjustmentSchema.safeParse({ delta: 0, reason: 'restock' });
    expect(messagesOf(result)).toContain('A quantidade do ajuste não pode ser zero');
  });

  it('rejeita delta fracionado', () => {
    const result = stockAdjustmentSchema.safeParse({ delta: 1.5, reason: 'restock' });
    expect(messagesOf(result)).toContain('A quantidade do ajuste deve ser um número inteiro');
  });

  it('rejeita delta acima do teto do INTEGER do banco (positivo e negativo)', () => {
    for (const delta of [3_000_000_000, -3_000_000_000]) {
      const result = stockAdjustmentSchema.safeParse({ delta, reason: 'restock' });
      expect(messagesOf(result)).toContain('A quantidade do ajuste é grande demais');
    }
  });

  it('rejeita note com mais de 500 caracteres com mensagem em PT-BR', () => {
    const result = stockAdjustmentSchema.safeParse({
      delta: 1,
      reason: 'restock',
      note: 'a'.repeat(501),
    });
    expect(messagesOf(result)).toContain('A observação deve ter no máximo 500 caracteres');
  });

  it.each(['order', 'order_cancelled', 'initial', 'xyz'])('rejeita reason %s', (reason) => {
    expect(stockAdjustmentSchema.safeParse({ delta: 1, reason }).success).toBe(false);
  });
});

describe('stockMovementSchema', () => {
  const movement = {
    id: 1,
    productId: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301',
    delta: -2,
    reason: 'order',
    orderId: '6ba7b810-9dad-41d1-80b5-00c04fd430c8',
    adminId: null,
    note: null,
    stockAfter: 8,
    createdAt: isoDate,
  };

  it('aceita movimento válido', () => {
    expect(stockMovementSchema.parse(movement)).toEqual(movement);
  });

  it.each(['initial', 'restock', 'adjustment', 'order', 'order_cancelled'])(
    'aceita reason %s',
    (reason) => {
      expect(stockMovementSchema.safeParse({ ...movement, reason }).success).toBe(true);
    },
  );

  it('rejeita reason desconhecido e stockAfter negativo', () => {
    expect(stockMovementSchema.safeParse({ ...movement, reason: 'x' }).success).toBe(false);
    expect(stockMovementSchema.safeParse({ ...movement, stockAfter: -1 }).success).toBe(false);
  });
});
