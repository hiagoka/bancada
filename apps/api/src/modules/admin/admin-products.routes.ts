import {
  adminProductInputSchema,
  adminProductUpdateSchema,
  adminProductsQuerySchema,
  stockAdjustmentSchema,
} from '@bancada/contracts';
import { Router } from 'express';
import { uuidOrNotFound } from '../../shared/http.js';
import type { AdminProductsService } from './admin-products.service.js';

export interface AdminProductsRouterDeps {
  service: AdminProductsService;
}

const NOT_FOUND = 'Produto não encontrado';

// Montado em /admin DEPOIS de requireCsrfHeader + requireAdmin (ver createApp).
export function createAdminProductsRouter({ service }: AdminProductsRouterDeps): Router {
  const router = Router();

  router.get('/products', async (req, res) => {
    const query = adminProductsQuerySchema.parse(req.query);
    res.json({ data: await service.list(query) });
  });

  router.get('/products/:id', async (req, res) => {
    const id = uuidOrNotFound(req.params.id, NOT_FOUND);
    res.json({ data: await service.get(id) });
  });

  router.post('/products', async (req, res) => {
    const input = adminProductInputSchema.parse(req.body);
    res.status(201).json({ data: await service.create(input, req.admin!.id) });
  });

  router.patch('/products/:id', async (req, res) => {
    const id = uuidOrNotFound(req.params.id, NOT_FOUND);
    const patch = adminProductUpdateSchema.parse(req.body);
    res.json({ data: await service.update(id, patch) });
  });

  router.post('/products/:id/stock', async (req, res) => {
    const id = uuidOrNotFound(req.params.id, NOT_FOUND);
    const adjustment = stockAdjustmentSchema.parse(req.body);
    res.json({ data: await service.adjustStock(id, adjustment, req.admin!.id) });
  });

  return router;
}
