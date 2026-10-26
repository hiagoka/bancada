import { ErrorCode, apiErrorSchema } from '../src/index.js';

const expectedCodes = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'OUT_OF_STOCK',
  'PRODUCT_UNAVAILABLE',
  'IDEMPOTENCY_KEY_REUSED',
  'CHECKOUT_UNAVAILABLE',
  'INVALID_SIGNATURE',
  'INVALID_JSON',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'SLUG_TAKEN',
  'INVALID_STOCK_ADJUSTMENT',
  'INVALID_FILE_TYPE',
  'ORDER_NOT_CANCELLABLE',
  'CSRF_REJECTED',
  'INTERNAL_ERROR',
];

describe('ErrorCode', () => {
  it('é a lista fechada da arquitetura', () => {
    expect([...ErrorCode.options].sort()).toEqual([...expectedCodes].sort());
  });

  it('inclui ORDER_NOT_CANCELLABLE e CSRF_REJECTED', () => {
    expect(ErrorCode.safeParse('ORDER_NOT_CANCELLABLE').success).toBe(true);
    expect(ErrorCode.safeParse('CSRF_REJECTED').success).toBe(true);
  });

  it('rejeita código fora da lista', () => {
    expect(ErrorCode.safeParse('OUTRO').success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('aceita envelope sem details', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Não encontrado' } };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('aceita envelope com details', () => {
    const body = {
      error: {
        code: 'OUT_OF_STOCK',
        message: 'Estoque insuficiente',
        details: [{ productId: 'x', requested: 3, available: 1 }],
      },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('rejeita código desconhecido e envelope sem error', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'NOT_FOUND', message: 'm' }).success).toBe(false);
  });
});
