import type { Product } from '@bancada/contracts';

let sequence = 0;

export function makeProduct(overrides: Partial<Product> = {}): Product {
  sequence += 1;
  const n = sequence.toString(16).padStart(12, '0');
  return {
    id: `3f2504e0-4f89-4d3a-9a0c-${n}`,
    slug: `produto-${sequence}`,
    name: `Produto ${sequence}`,
    description: 'Descrição',
    category: 'Teclados',
    priceCents: 10000,
    stock: 10,
    imageUrl: null,
    ...overrides,
  };
}

// Storage falso em memória (não depende de jsdom).
export class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
