import type { UploadResponse } from '@bancada/contracts';

export interface StorageService {
  // Lança AppError 400 INVALID_FILE_TYPE para tipos fora de jpeg/png/webp.
  createUpload(contentType: string): Promise<UploadResponse>;
  publicUrl(key: string): string;
}
