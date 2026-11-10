import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { MAX_UPLOAD_BYTES, type UploadResponse } from '@bancada/contracts';
import type { StorageService } from './storage.service.js';
import { newUploadKey } from './upload-key.js';

export const UPLOAD_EXPIRES_SECONDS = 5 * 60;

export interface S3StorageDeps {
  client: S3Client;
  bucket: string;
  // Base pública dos objetos (S3_PUBLIC_URL), sem barra final.
  publicUrl: string;
  // Cliente só para ASSINAR o presigned POST (offline): define o host do uploadUrl. Padrão: client.
  presignClient?: S3Client;
  // Validade da política do presigned POST (padrão 300 s; testes usam valores curtos).
  expiresSeconds?: number;
}

// Upload direto do navegador para o S3/MinIO (D10): a imagem não passa pela API. O limite de
// 2 MB, o Content-Type e a chave são impostos pela POLÍTICA assinada, ou seja, pelo próprio S3.
export class S3StorageService implements StorageService {
  private readonly publicBase: string;

  constructor(private readonly deps: S3StorageDeps) {
    this.publicBase = deps.publicUrl.replace(/\/+$/, '');
  }

  async createUpload(contentType: string): Promise<UploadResponse> {
    const key = newUploadKey(contentType);
    // Content-Type, key e bucket entram na política como condições de igualdade exata.
    const { url, fields } = await createPresignedPost(this.deps.presignClient ?? this.deps.client, {
      Bucket: this.deps.bucket,
      Key: key,
      Conditions: [['content-length-range', 0, MAX_UPLOAD_BYTES]],
      Fields: { 'Content-Type': contentType },
      Expires: this.deps.expiresSeconds ?? UPLOAD_EXPIRES_SECONDS,
    });
    return { uploadUrl: url, fields, key };
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  // Vazio na AWS; http://localhost:9000 no MinIO.
  endpoint?: string;
  // Endpoint que o navegador enxerga (uploadUrl do presigned POST), se diferente de `endpoint`.
  presignEndpoint?: string;
  forcePathStyle: boolean;
}

export function createS3Storage(config: S3Config): S3StorageService {
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials,
  });
  // Assinar o presigned POST não faz chamada de rede: o endpoint só decide o host do uploadUrl.
  const presignClient =
    config.presignEndpoint === undefined
      ? undefined
      : new S3Client({
          region: config.region,
          endpoint: config.presignEndpoint,
          forcePathStyle: config.forcePathStyle,
          credentials,
        });
  return new S3StorageService({
    client,
    presignClient,
    bucket: config.bucket,
    publicUrl: config.publicUrl,
  });
}
