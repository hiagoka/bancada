import type { Product } from '@bancada/contracts';

export interface CategoryGroup {
  category: string;
  products: Product[];
}

// Uma seção por categoria, em ordem alfabética (pt-BR); dentro dela, a ordem da API (por nome).
export function groupByCategory(products: Product[]): CategoryGroup[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const list = groups.get(product.category) ?? [];
    list.push(product);
    groups.set(product.category, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    .map(([category, list]) => ({ category, products: list }));
}
