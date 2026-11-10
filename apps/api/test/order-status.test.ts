import {
  ALLOWED_TRANSITIONS,
  canTransition,
  paymentStatusToOrderStatus,
} from '../src/modules/orders/order-status.js';

describe('paymentStatusToOrderStatus', () => {
  it.each([
    ['approved', 'PAID'],
    ['cancelled', 'CANCELLED'],
    ['refunded', 'REFUNDED'],
    ['charged_back', 'REFUNDED'],
  ])('%s -> %s', (status, target) => {
    expect(paymentStatusToOrderStatus(status)).toBe(target);
  });

  it.each(['pending', 'in_process', 'authorized', 'rejected'])('%s -> nenhum alvo', (status) => {
    expect(paymentStatusToOrderStatus(status)).toBeNull();
  });

  it('status desconhecido -> nenhum alvo', () => {
    expect(paymentStatusToOrderStatus('algo_novo')).toBeNull();
    expect(paymentStatusToOrderStatus('')).toBeNull();
  });
});

describe('canTransition', () => {
  const statuses = ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'] as const;
  const allowed = new Set(['PENDING>PAID', 'PENDING>CANCELLED', 'PAID>REFUNDED']);

  for (const from of statuses) {
    for (const to of statuses) {
      const expected = allowed.has(`${from}>${to}`);
      it(`${from} -> ${to}: ${expected ? 'permitida' : 'proibida'}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it('só existem as 3 transições da seção 8.3', () => {
    const all = Object.entries(ALLOWED_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}>${to}`),
    );
    expect(new Set(all)).toEqual(allowed);
  });
});
