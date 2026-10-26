import type { UploadRequest, UploadResponse } from '@bancada/contracts';

export interface StorageService {
  createUpload(contentType: UploadRequest['contentType']): Promise<UploadResponse>;
  publicUrl(key: string): string;
}
