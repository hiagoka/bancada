import {
  ALLOWED_TRANSITIONS,
  canTransition,
  mpStatusToOrderStatus,
} from '../src/modules/orders/order-status.js';

describe('mpStatusToOrderStatus', () => {
  it.each([
    ['approved', 'PAID'],
    ['cancelled', 'CANCELLED'],
    ['refunded', 'REFUNDED'],
    ['charged_back', 'REFUNDED'],
  ])('%s -> %s', (mp, target) => {
    expect(mpStatusToOrderStatus(mp)).toBe(target);
  });

  it.each(['pending', 'in_process', 'authorized', 'rejected'])('%s -> nenhum alvo', (mp) => {
    expect(mpStatusToOrderStatus(mp)).toBeNull();
  });

  it('status desconhecido -> nenhum alvo', () => {
    expect(mpStatusToOrderStatus('algo_novo')).toBeNull();
    expect(mpStatusToOrderStatus('')).toBeNull();
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
