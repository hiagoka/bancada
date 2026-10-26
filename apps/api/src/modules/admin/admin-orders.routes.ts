import { adminOrdersQuerySchema } from '@bancada/contracts';
import { Router } from 'express';
import { uuidOrNotFound } from '../../shared/http.js';
import type { AdminOrdersService } from './admin-orders.service.js';

export interface AdminOrdersRouterDeps {
  service: AdminOrdersService;
}

// Único lugar (junto com a resposta do cancelamento) onde aparecem os dados do cliente.
// Montado em /admin DEPOIS de requireCsrfHeader + requireAdmin (ver createApp).
export function createAdminOrdersRouter({ service }: AdminOrdersRouterDeps): Router {
  const router = Router();

  router.get('/orders', async (req, res) => {
    const query = adminOrdersQuerySchema.parse(req.query);
    res.json({ data: await service.list(query) });
  });

  router.post('/orders/:id/cancel', async (req, res) => {
    const id = uuidOrNotFound(req.params.id, 'Pedido não encontrado');
    res.json({ data: await service.cancel(id, req.admin!.id) });
  });

  return router;
}
