import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../../api/products';

export const PRODUCTS_QUERY_KEY = ['products'] as const;

// `refetchOnMount: 'always'` (carrinho): confere o estoque de agora, não o do cache de 30 s.
export function useProducts(options: { refetchOnMount?: boolean | 'always' } = {}) {
  return useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    ...options,
  });
}
