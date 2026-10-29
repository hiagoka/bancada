import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getAdminProduct,
  listAdminProducts,
  type AdminProductFilters,
} from '../../api/adminProducts';

// Chaves do ARCHITECTURE.md (seção 9): ['admin','products', filtros] e ['admin','product', id].
export const adminProductsKey = (filters: AdminProductFilters) =>
  ['admin', 'products', filters] as const;
export const adminProductKey = (id: string) => ['admin', 'product', id] as const;

export function useAdminProducts(filters: AdminProductFilters) {
  return useQuery({
    queryKey: adminProductsKey(filters),
    queryFn: ({ signal }) => listAdminProducts(filters, signal),
    placeholderData: keepPreviousData, // digitando na busca a tabela não some
  });
}

export function useAdminProduct(id: string) {
  return useQuery({
    queryKey: adminProductKey(id),
    queryFn: ({ signal }) => getAdminProduct(id, signal),
  });
}
