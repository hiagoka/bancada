import { z } from 'zod';

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'OUT_OF_STOCK',
  'PRODUCT_UNAVAILABLE',
  'IDEMPOTENCY_KEY_REUSED',
  'CHECKOUT_UNAVAILABLE',
  'INVALID_SIGNATURE',
  'INVALID_JSON',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'SLUG_TAKEN',
  'INVALID_STOCK_ADJUSTMENT',
  'INVALID_FILE_TYPE',
  'ORDER_NOT_CANCELLABLE',
  'CSRF_REJECTED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
