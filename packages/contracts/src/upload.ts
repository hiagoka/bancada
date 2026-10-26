import { z } from 'zod';

export const uploadRequestSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp'], {
    error: 'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP',
  }),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.object({
  uploadUrl: z.string(),
  fields: z.record(z.string(), z.string()),
  key: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
