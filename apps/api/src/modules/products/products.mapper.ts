import {
  adminProductSchema,
  productSchema,
  type AdminProduct,
  type Product,
} from '@bancada/contracts';
import type { StorageService } from '../storage/storage.service.js';
import type { ProductRecord } from './products.repository.js';

function imageUrl(record: ProductRecord, storage: StorageService): string | null {
  return record.imageKey ? storage.publicUrl(record.imageKey) : null;
}

// Só os campos públicos; o parse garante o contrato (nada de active, imageKey, datas).
// Dado do banco fora do contrato é bug nosso (500), não erro de validação do cliente (400).
export function toPublicProduct(record: ProductRecord, storage: StorageService): Product {
  const parsed = productSchema.safeParse({
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    category: record.category,
    priceCents: record.priceCents,
    stock: record.stock,
    imageUrl: imageUrl(record, storage),
  });
  if (!parsed.success) throw new Error('Produto fora do contrato público', { cause: parsed.error });
  return parsed.data;
}

// Visão do admin: inclui active, imageKey e datas. Nunca use fora de /admin.
export function toAdminProduct(record: ProductRecord, storage: StorageService): AdminProduct {
  const parsed = adminProductSchema.safeParse({
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    category: record.category,
    priceCents: record.priceCents,
    stock: record.stock,
    imageUrl: imageUrl(record, storage),
    active: record.active,
    imageKey: record.imageKey,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
  if (!parsed.success)
    throw new Error('Produto fora do contrato de admin', { cause: parsed.error });
  return parsed.data;
}
