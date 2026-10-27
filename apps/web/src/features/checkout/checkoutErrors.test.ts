import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { makeProduct } from '../../test/fixtures';
import { describeCheckoutError } from './checkoutErrors';

const a = makeProduct({ name: 'Mouse' });
const b = makeProduct({ name: 'Teclado' });
const lines = [
  { product: a, quantity: 5 },
  { product: b, quantity: 1 },
];

describe('describeCheckoutError', () => {
  it('OUT_OF_STOCK: um item por produto com o nome do carrinho, pedido e disponível', () => {
    const error = new ApiError(409, 'OUT_OF_STOCK', 'Estoque insuficiente', [
      { productId: a.id, requested: 5, available: 2 },
      { productId: b.id, requested: 1, available: 0 },
    ]);
    expect(describeCheckoutError(error, lines)).toEqual({
      kind: 'out_of_stock',
      items: [
        { productId: a.id, name: 'Mouse', requested: 5, available: 2 },
        { productId: b.id, name: 'Teclado', requested: 1, available: 0 },
      ],
    });
  });

  it('OUT_OF_STOCK com details inválidos: sem itens (mensagem genérica de estoque)', () => {
    for (const details of [undefined, 'x', [{ productId: 1 }], [{ productId: a.id }]]) {
      expect(describeCheckoutError(new ApiError(409, 'OUT_OF_STOCK', 'm', details), lines)).toEqual(
        { kind: 'out_of_stock', items: [] },
      );
    }
  });

  it('PRODUCT_UNAVAILABLE: nomes dos itens que saíram do catálogo', () => {
    const error = new ApiError(422, 'PRODUCT_UNAVAILABLE', 'm', [{ productId: b.id }]);
    expect(describeCheckoutError(error, lines)).toEqual({
      kind: 'unavailable',
      items: [{ productId: b.id, name: 'Teclado' }],
    });
  });

  it('OUT_OF_STOCK com produto desconhecido usa "Produto" (não "indisponível")', () => {
    const error = new ApiError(409, 'OUT_OF_STOCK', 'm', [
      { productId: '00000000-0000-4000-8000-000000000000', requested: 2, available: 1 },
    ]);
    expect(describeCheckoutError(error, lines)).toMatchObject({ items: [{ name: 'Produto' }] });
  });

  it('PRODUCT_UNAVAILABLE com produto desconhecido do carrinho usa um nome genérico', () => {
    const error = new ApiError(422, 'PRODUCT_UNAVAILABLE', 'm', [
      { productId: '00000000-0000-4000-8000-000000000000' },
    ]);
    expect(describeCheckoutError(error, lines)).toMatchObject({
      items: [{ name: 'Produto indisponível' }],
    });
  });

  it('CHECKOUT_UNAVAILABLE sem reason: pedido reservado, mesma chave', () => {
    const error = new ApiError(502, 'CHECKOUT_UNAVAILABLE', 'm', { orderId: 'o1' });
    expect(describeCheckoutError(error, lines)).toEqual({
      kind: 'checkout_unavailable',
      expired: false,
    });
  });

  it("CHECKOUT_UNAVAILABLE com reason 'expired': expirou, chave nova", () => {
    const error = new ApiError(502, 'CHECKOUT_UNAVAILABLE', 'm', {
      orderId: 'o1',
      reason: 'expired',
    });
    expect(describeCheckoutError(error, lines)).toEqual({
      kind: 'checkout_unavailable',
      expired: true,
    });
  });

  it('IDEMPOTENCY_KEY_REUSED', () => {
    expect(describeCheckoutError(new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'm'), lines)).toEqual({
      kind: 'reused',
    });
  });

  it('VALIDATION_ERROR: mensagens do servidor (details), sem culpar o usuário', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Dados inválidos', [
      { path: 'items', message: 'O valor total do pedido excede o limite permitido' },
      { path: 'items', message: 'A quantidade máxima por item é 999' },
    ]);
    expect(describeCheckoutError(error, lines)).toEqual({
      kind: 'validation',
      messages: [
        'O valor total do pedido excede o limite permitido',
        'A quantidade máxima por item é 999',
      ],
    });
  });

  it('VALIDATION_ERROR sem details legíveis: usa a mensagem do erro', () => {
    expect(
      describeCheckoutError(new ApiError(400, 'VALIDATION_ERROR', 'Dados inválidos'), lines),
    ).toEqual({
      kind: 'validation',
      messages: ['Dados inválidos'],
    });
  });

  it('NetworkError', () => {
    expect(describeCheckoutError(new NetworkError(), lines)).toEqual({ kind: 'network' });
  });

  it.each([
    new ApiError(500, 'INTERNAL_ERROR', 'x'),
    new ApiError(429, 'RATE_LIMITED', 'x'),
    new Error('boom'),
    'texto',
    null,
  ])('qualquer outro erro (%p): genérico', (error) => {
    expect(describeCheckoutError(error, lines)).toEqual({ kind: 'generic' });
  });
});
