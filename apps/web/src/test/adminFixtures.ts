import type { AdminOrdersPage, AdminProduct, Order } from '@bancada/contracts';

export const PRODUCT_ID = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
export const IMAGE_KEY = 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png';

export function makeAdminProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: PRODUCT_ID,
    slug: 'teclado-mecanico',
    name: 'Teclado Mecânico',
    description: 'Switch marrom, layout ABNT2.',
    category: 'Teclados',
    priceCents: 34990,
    stock: 12,
    imageUrl: null,
    active: true,
    imageKey: null,
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

export const ORDER_ID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

export function makeAdminOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    status: 'PENDING',
    items: [
      { productId: PRODUCT_ID, productName: 'Mouse Sem Fio', unitPriceCents: 24900, quantity: 2 },
      {
        productId: 'a1b2c3d4-0000-4000-8000-000000000001',
        productName: 'Caneca Dev',
        unitPriceCents: 4900,
        quantity: 1,
      },
    ],
    totalCents: 54700,
    checkoutUrl: null,
    paidAt: null,
    createdAt: '2026-10-27T15:30:00.000Z',
    customer: { name: 'Ana Souza', email: 'ana@example.com' },
    cancellable: false,
    ...overrides,
  };
}

export function makeOrdersPage(items: Order[], page = 1, total = items.length): AdminOrdersPage {
  return { items, page, pageSize: 20, total };
}
