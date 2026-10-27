import type { PublicOrder } from '@bancada/contracts';

export const ORDER_ID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

export function makeOrder(overrides: Partial<PublicOrder> = {}): PublicOrder {
  return {
    id: ORDER_ID,
    status: 'PENDING',
    items: [
      {
        productId: '6ba7b810-9dad-41d1-80b5-00c04fd430c8',
        productName: 'Mouse Sem Fio Ergonômico',
        unitPriceCents: 24900,
        quantity: 2,
      },
      {
        productId: '7ba7b810-9dad-41d1-80b5-00c04fd430c9',
        productName: 'Caneca Térmica Dev',
        unitPriceCents: 4900,
        quantity: 1,
      },
    ],
    totalCents: 54700,
    checkoutUrl: null,
    paidAt: null,
    createdAt: '2026-10-27T15:30:00.000Z',
    ...overrides,
  };
}
