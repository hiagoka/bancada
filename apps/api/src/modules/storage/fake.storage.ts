import type { UploadResponse } from '@bancada/contracts';
import type { StorageService } from './storage.service.js';
import { newUploadKey } from './upload-key.js';

// Para testes: sem rede e com URLs determinísticas. Mesma validação de tipo e mesmo formato de
// chave do S3StorageService.
export class FakeStorageService implements StorageService {
  async createUpload(contentType: string): Promise<UploadResponse> {
    const key = newUploadKey(contentType);
    return {
      uploadUrl: 'https://upload.test/bancada',
      fields: { key, 'Content-Type': contentType },
      key,
    };
  }

  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
}
