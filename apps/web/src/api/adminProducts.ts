import {
  adminProductDetailSchema,
  adminProductInputSchema,
  adminProductSchema,
  adminProductUpdateSchema,
  uploadRequestSchema,
  uploadResponseSchema,
  type AdminProduct,
  type AdminProductDetail,
  type AdminProductInput,
  type AdminProductUpdate,
  type UploadResponse,
} from '@bancada/contracts';
import { z } from 'zod';
import { request } from './http';

export interface AdminProductFilters {
  q?: string;
  // 'all' = sem filtro de situação.
  active?: 'all' | 'true' | 'false';
}

const productsSchema = z.array(adminProductSchema);
const productPath = (id: string): string => `/admin/products/${encodeURIComponent(id)}`;

// GET /admin/products?q=&active= (todos, inclusive inativos). Filtro vazio não vai na URL.
export function listAdminProducts(
  filters: AdminProductFilters,
  signal?: AbortSignal,
): Promise<AdminProduct[]> {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  if (q) params.set('q', q);
  if (filters.active === 'true' || filters.active === 'false') params.set('active', filters.active);
  const query = params.toString();
  return request(`/admin/products${query ? `?${query}` : ''}`, { schema: productsSchema, signal });
}

// GET /admin/products/:id: produto + últimas movimentações.
export function getAdminProduct(id: string, signal?: AbortSignal): Promise<AdminProductDetail> {
  return request(productPath(id), { schema: adminProductDetailSchema, signal });
}

// POST /admin/products. O corpo é montado campo a campo: o schema é estrito (active, stock e slug
// dariam 400), então nada além destes campos sai daqui.
export async function createAdminProduct(input: AdminProductInput): Promise<AdminProduct> {
  const parsed = adminProductInputSchema.parse(input);
  return request('/admin/products', {
    method: 'POST',
    body: {
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      priceCents: parsed.priceCents,
      initialStock: parsed.initialStock,
      ...(parsed.imageKey === undefined ? {} : { imageKey: parsed.imageKey }),
    },
    schema: adminProductSchema,
  });
}

// PATCH /admin/products/:id. imageKey: ausente mantém, null remove, string troca (D16).
export async function updateAdminProduct(
  id: string,
  patch: AdminProductUpdate,
): Promise<AdminProduct> {
  const parsed = adminProductUpdateSchema.parse(patch);
  return request(productPath(id), { method: 'PATCH', body: parsed, schema: adminProductSchema });
}

// POST /admin/uploads/product-image: presigned POST para enviar a imagem direto ao S3/MinIO.
export async function requestProductImageUpload(
  contentType: string,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  const body = uploadRequestSchema.parse({ contentType });
  return request('/admin/uploads/product-image', {
    method: 'POST',
    body,
    schema: uploadResponseSchema,
    signal,
  });
}
