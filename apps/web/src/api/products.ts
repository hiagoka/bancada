import { productSchema } from '@bancada/contracts';
import { z } from 'zod';
import { request } from './http';

const productsSchema = z.array(productSchema);

// GET /products (só ativos, por nome), validado com o productSchema do contracts.
export function fetchProducts(signal?: AbortSignal) {
  return request('/products', { schema: productsSchema, signal });
}
