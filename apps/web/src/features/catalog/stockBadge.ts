export const LOW_STOCK_LIMIT = 3;

// Texto do selo de status do card (D25): "Últimas N un." com estoque 1..3 e "Esgotado" com 0.
export function stockBadge(stock: number): string | null {
  if (stock <= 0) return 'Esgotado';
  if (stock <= LOW_STOCK_LIMIT) return `Últimas ${stock} un.`;
  return null;
}
