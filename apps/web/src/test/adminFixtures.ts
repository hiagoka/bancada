import type { AdminProduct } from '@bancada/contracts';

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
