import { paymentStatusSchema, simulatePaymentInputSchema } from '../src/index.js';
import { messagesOf, uuid } from './fixtures.js';

describe('paymentStatusSchema', () => {
  it.each([
    'approved',
    'pending',
    'in_process',
    'authorized',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
    'in_mediation',
  ])('aceita %s', (status) => {
    expect(paymentStatusSchema.safeParse(status).success).toBe(true);
  });

  it('rejeita status desconhecido', () => {
    expect(paymentStatusSchema.safeParse('paid').success).toBe(false);
  });
});

describe('simulatePaymentInputSchema', () => {
  it('aceita só orderId e status', () => {
    expect(simulatePaymentInputSchema.parse({ orderId: uuid, status: 'approved' })).toEqual({
      orderId: uuid,
      status: 'approved',
    });
  });

  it('aceita amountCents e paymentId opcionais', () => {
    const input = { orderId: uuid, status: 'refunded', amountCents: 1500, paymentId: 'pay-1' };
    expect(simulatePaymentInputSchema.parse(input)).toEqual(input);
  });

  it('rejeita orderId que não é UUID com mensagem em PT-BR', () => {
    const result = simulatePaymentInputSchema.safeParse({ orderId: 'x', status: 'approved' });
    expect(messagesOf(result)).toContain('Pedido inválido');
  });

  it('rejeita status inválido com mensagem em PT-BR', () => {
    const result = simulatePaymentInputSchema.safeParse({ orderId: uuid, status: 'pago' });
    expect(messagesOf(result)).toContain('Status de pagamento inválido');
  });

  it.each([0, -1, 1.5, 3_000_000_000])('rejeita amountCents %p', (amountCents) => {
    const result = simulatePaymentInputSchema.safeParse({
      orderId: uuid,
      status: 'approved',
      amountCents,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita paymentId vazio ou longo demais', () => {
    for (const paymentId of ['', 'x'.repeat(65)]) {
      expect(
        simulatePaymentInputSchema.safeParse({ orderId: uuid, status: 'approved', paymentId })
          .success,
      ).toBe(false);
    }
  });
});
