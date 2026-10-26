import type { UploadResponse } from '@bancada/contracts';
import { AppError } from '../../shared/errors.js';
import type { StorageService } from './storage.service.js';

// Provisório (até a T12, que traz o S3StorageService): só sabe montar a URL pública da imagem.
export class PublicUrlStorageService implements StorageService {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async createUpload(): Promise<UploadResponse> {
    throw new AppError(501, 'INTERNAL_ERROR', 'Upload de imagens ainda não implementado');
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
