import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import {
  MOVEMENT_REASON_LABEL,
  describeStockError,
  formatDelta,
  stockFormSchema,
} from './stockForm';

const valid = { delta: '5', reason: 'restock', note: '' };

describe('stockFormSchema', () => {
  it.each([
    ['5', 5],
    ['+5', 5],
    ['-3', -3],
    [' 12 ', 12],
    ['-0012', -12],
  ])('delta "%s" -> %i (inteiro com sinal)', (delta, expected) => {
    expect(stockFormSchema.parse({ ...valid, delta }).delta).toBe(expected);
  });

  it.each([
    ['', 'Informe a quantidade do ajuste'],
    ['0', 'A quantidade do ajuste não pode ser zero'],
    ['-0', 'A quantidade do ajuste não pode ser zero'],
    ['2,5', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
    ['1.5', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
    ['abc', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
    ['--3', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
    ['99999999999', 'A quantidade do ajuste é grande demais'],
  ])('delta "%s" é recusado: %s', (delta, message) => {
    const result = stockFormSchema.safeParse({ ...valid, delta });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it('motivo: só reposição ou ajuste', () => {
    expect(stockFormSchema.safeParse({ ...valid, reason: 'order' }).success).toBe(false);
    expect(stockFormSchema.safeParse({ ...valid, reason: 'adjustment' }).success).toBe(true);
  });

  it('nota em branco vira ausente; nota é aparada; passa de 500 é recusada', () => {
    expect(stockFormSchema.parse({ ...valid, note: '   ' }).note).toBeUndefined();
    expect(stockFormSchema.parse({ ...valid, note: ' caixa ' }).note).toBe('caixa');
    const result = stockFormSchema.safeParse({ ...valid, note: 'x'.repeat(501) });
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'A observação deve ter no máximo 500 caracteres',
    );
  });
});

describe('formatDelta', () => {
  it.each([
    [5, '+5'],
    [-3, '−3'],
    [0, '0'],
  ])('%i -> %s', (delta, text) => {
    expect(formatDelta(delta)).toBe(text);
  });
});

describe('MOVEMENT_REASON_LABEL', () => {
  it('um rótulo em PT-BR para cada motivo', () => {
    expect(MOVEMENT_REASON_LABEL).toEqual({
      initial: 'Estoque inicial',
      restock: 'Reposição',
      adjustment: 'Ajuste',
      order: 'Pedido',
      order_cancelled: 'Pedido cancelado',
    });
  });
});

describe('describeStockError', () => {
  it('409: estoque ficaria negativo, com o estoque atual', () => {
    expect(describeStockError(new ApiError(409, 'INVALID_STOCK_ADJUSTMENT', 'x'), 4)).toBe(
      'Esse ajuste deixaria o estoque negativo. O estoque atual é 4; nada foi alterado.',
    );
  });

  it.each([
    [new ApiError(404, 'NOT_FOUND', 'x'), 'Produto não encontrado. Ele pode ter sido removido.'],
    [new ApiError(400, 'VALIDATION_ERROR', 'x'), 'Confira os campos do ajuste e tente de novo.'],
    [new NetworkError(), 'A API está fora do ar. Verifique sua conexão e tente de novo.'],
    [new Error('boom'), 'Não foi possível ajustar o estoque. Tente de novo em instantes.'],
  ])('%s', (error, message) => {
    expect(describeStockError(error, 4)).toBe(message);
  });
});
