import type { AdminProduct, AdminProductInput, AdminProductUpdate } from '@bancada/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createAdminProduct, updateAdminProduct } from '../../api/adminProducts';
import { PRODUCTS_QUERY_KEY } from '../catalog/useProducts';
import { useAdminMutation } from './useAdminMutation';

// Depois de criar ou editar: lista do admin, detalhe (se houver id) e catálogo da loja.
export function invalidateProductCaches(client: QueryClient, id?: string): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['admin', 'products'] }),
    id ? client.invalidateQueries({ queryKey: ['admin', 'product', id] }) : undefined,
    client.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY }),
  ]);
}

export function useCreateProduct() {
  const client = useQueryClient();
  return useAdminMutation<AdminProduct, Error, AdminProductInput>({
    mutationKey: ['product', 'create'],
    mutationFn: createAdminProduct,
    onSuccess: (product) => invalidateProductCaches(client, product.id),
  });
}

export function useUpdateProduct(id: string) {
  const client = useQueryClient();
  return useAdminMutation<AdminProduct, Error, AdminProductUpdate>({
    mutationKey: ['product', 'update'],
    mutationFn: (patch) => updateAdminProduct(id, patch),
    onSuccess: () => invalidateProductCaches(client, id),
  });
}
