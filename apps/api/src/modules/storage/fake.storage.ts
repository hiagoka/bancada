import { randomUUID } from 'node:crypto';
import type { UploadRequest, UploadResponse } from '@bancada/contracts';
import type { StorageService } from './storage.service.js';

const EXTENSIONS: Record<UploadRequest['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Para testes: sem rede e com URLs determinísticas.
export class FakeStorageService implements StorageService {
  async createUpload(contentType: UploadRequest['contentType']): Promise<UploadResponse> {
    const key = `products/${randomUUID()}.${EXTENSIONS[contentType]}`;
    return { uploadUrl: 'https://upload.test/bancada', fields: { key }, key };
  }

  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
}
