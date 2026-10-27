import { randomUUID } from 'node:crypto';
import { INVALID_FILE_TYPE_MESSAGE, type UploadRequest } from '@bancada/contracts';
import { AppError } from '../../shared/errors.js';

const EXTENSIONS: Record<UploadRequest['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isAllowed(contentType: string): contentType is UploadRequest['contentType'] {
  return Object.hasOwn(EXTENSIONS, contentType);
}

// Só image/jpeg, image/png e image/webp, exatamente como declarados. Qualquer outro tipo:
// 400 INVALID_FILE_TYPE. A chave (products/<uuid v4>.<jpg|png|webp>) casa com o imageKey do
// contracts. Atenção: o tipo é o DECLARADO pelo cliente; o S3 não valida o conteúdo real.
export function newUploadKey(contentType: string): string {
  if (!isAllowed(contentType)) {
    throw new AppError(400, 'INVALID_FILE_TYPE', INVALID_FILE_TYPE_MESSAGE);
  }
  return `products/${randomUUID()}.${EXTENSIONS[contentType]}`;
}
