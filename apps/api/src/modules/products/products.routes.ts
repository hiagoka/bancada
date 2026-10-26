import { productSchema, type Product } from '@bancada/contracts';
import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import type { StorageService } from '../storage/storage.service.js';
import {
  findActiveProductById,
  listActiveProducts,
  type ProductRecord,
} from './products.repository.js';

export interface ProductsRouterDeps {
  pool: Db;
  storage: StorageService;
}

const idSchema = z.uuid();

export function createProductsRouter({ pool, storage }: ProductsRouterDeps): Router {
  // Só os campos públicos; o parse garante o contrato (nada de active, imageKey, datas).
  const toPublic = (record: ProductRecord): Product => {
    const parsed = productSchema.safeParse({
      id: record.id,
      slug: record.slug,
      name: record.name,
      description: record.description,
      category: record.category,
      priceCents: record.priceCents,
      stock: record.stock,
      imageUrl: record.imageKey ? storage.publicUrl(record.imageKey) : null,
    });
    // Dado do banco fora do contrato é bug nosso (500), não erro de validação do cliente (400).
    if (!parsed.success)
      throw new Error('Produto fora do contrato público', { cause: parsed.error });
    return parsed.data;
  };

  const router = Router();

  router.get('/products', async (_req, res) => {
    const products = await listActiveProducts(pool);
    res.json({ data: products.map(toPublic) });
  });

  router.get('/products/:id', async (req, res) => {
    // Id que não é UUID não existe: 404 sem passar pelo banco (evita o erro 22P02 do pg).
    const id = idSchema.safeParse(req.params.id);
    const product = id.success ? await findActiveProductById(pool, id.data) : null;
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Produto não encontrado');
    res.json({ data: toPublic(product) });
  });

  return router;
}
