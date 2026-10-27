import { z } from 'zod';

export const ALLOWED_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
// Limite imposto pelo próprio S3 na política do presigned POST (content-length-range).
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const INVALID_FILE_TYPE_MESSAGE = 'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP';

export const uploadRequestSchema = z.object({
  contentType: z.enum(ALLOWED_UPLOAD_CONTENT_TYPES, { error: INVALID_FILE_TYPE_MESSAGE }),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.object({
  uploadUrl: z.string(),
  fields: z.record(z.string(), z.string()),
  key: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
