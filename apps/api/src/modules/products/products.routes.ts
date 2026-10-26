import type { Product } from '@bancada/contracts';
import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { toPublicProduct } from './products.mapper.js';
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
  const toPublic = (record: ProductRecord): Product => toPublicProduct(record, storage);

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
