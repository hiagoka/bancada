import { INVALID_FILE_TYPE_MESSAGE, uploadRequestSchema } from '@bancada/contracts';
import { Router } from 'express';
import { AppError } from '../../shared/errors.js';
import type { StorageService } from '../storage/storage.service.js';

export interface UploadsRouterDeps {
  storage: StorageService;
}

// Montado em /admin DEPOIS de requireCsrfHeader + requireAdmin (ver createApp).
export function createUploadsRouter({ storage }: UploadsRouterDeps): Router {
  const router = Router();

  router.post('/uploads/product-image', async (req, res) => {
    // Qualquer problema no contentType (ausente, vazio, não-string, tipo não permitido) é
    // INVALID_FILE_TYPE, não VALIDATION_ERROR.
    const parsed = uploadRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_FILE_TYPE', INVALID_FILE_TYPE_MESSAGE);
    res.json({ data: await storage.createUpload(parsed.data.contentType) });
  });

  return router;
}
