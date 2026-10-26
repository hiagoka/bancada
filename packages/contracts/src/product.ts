import { z } from 'zod';
import { MAX_INT4 } from './limits.js';
import { stockMovementSchema } from './stock.js';

const priceCentsSchema = z
  .number({ error: 'Informe o preço em centavos' })
  .int({ error: 'O preço deve ser um número inteiro de centavos' })
  .positive({ error: 'O preço deve ser maior que zero' })
  .max(MAX_INT4, { error: 'O preço é alto demais' });

const nameSchema = z
  .string({ error: 'Informe o nome do produto' })
  .trim()
  .min(1, { error: 'Informe o nome do produto' })
  .max(120, { error: 'O nome deve ter no máximo 120 caracteres' });

const descriptionSchema = z
  .string({ error: 'Informe a descrição do produto' })
  .trim()
  .min(1, { error: 'Informe a descrição do produto' })
  .max(2000, { error: 'A descrição deve ter no máximo 2000 caracteres' });

const categorySchema = z
  .string({ error: 'Informe a categoria do produto' })
  .trim()
  .min(1, { error: 'Informe a categoria do produto' })
  .max(60, { error: 'A categoria deve ter no máximo 60 caracteres' });

// Chave gerada pelo upload (T12): products/<uuid>.<jpg|png|webp>.
const IMAGE_KEY_PATTERN =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const imageKeySchema = z
  .string({ error: 'A chave da imagem deve ser um texto' })
  .regex(IMAGE_KEY_PATTERN, { error: 'Chave de imagem inválida' });

// Campo desconhecido é recusado (em vez de descartado em silêncio).
const unrecognizedKeysError = (issue: z.core.$ZodRawIssue): string =>
  issue.code === 'unrecognized_keys'
    ? `Campo não permitido: ${issue.keys.join(', ')}`
    : 'Corpo inválido';

export const productSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  priceCents: priceCentsSchema,
  stock: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
});
export type Product = z.infer<typeof productSchema>;

export const adminProductSchema = productSchema.extend({
  active: z.boolean(),
  imageKey: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

export const adminProductInputSchema = z.strictObject(
  {
    name: nameSchema,
    description: descriptionSchema,
    category: categorySchema,
    priceCents: priceCentsSchema,
    initialStock: z
      .number({ error: 'Informe o estoque inicial' })
      .int({ error: 'O estoque inicial deve ser um número inteiro' })
      .nonnegative({ error: 'O estoque inicial não pode ser negativo' })
      .max(MAX_INT4, { error: 'O estoque inicial é alto demais' }),
    imageKey: imageKeySchema.optional(),
  },
  { error: unrecognizedKeysError },
);

export type AdminProductInput = z.infer<typeof adminProductInputSchema>;

// imageKey: ausente mantém a imagem, null remove, string troca (D16).
// Estoque e slug NÃO são alterados aqui: campo desconhecido é recusado (strict).
export const adminProductUpdateSchema = z
  .strictObject(
    {
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
      category: categorySchema.optional(),
      priceCents: priceCentsSchema.optional(),
      active: z.boolean({ error: 'O campo ativo deve ser verdadeiro ou falso' }).optional(),
      imageKey: imageKeySchema.nullable().optional(),
    },
    { error: unrecognizedKeysError },
  )
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Informe ao menos um campo para atualizar',
  });
export type AdminProductUpdate = z.infer<typeof adminProductUpdateSchema>;

// GET /admin/products?q=&active=
export const adminProductsQuerySchema = z.object({
  q: z
    .string({ error: 'A busca deve ser um texto' })
    .trim()
    .max(100, { error: 'A busca deve ter no máximo 100 caracteres' })
    .optional(),
  active: z
    .enum(['true', 'false'], { error: 'O filtro active deve ser "true" ou "false"' })
    .transform((value) => value === 'true')
    .optional(),
});
export type AdminProductsQuery = z.infer<typeof adminProductsQuerySchema>;

// GET /admin/products/:id: produto + últimas movimentações (mais recentes primeiro).
export const adminProductDetailSchema = adminProductSchema.extend({
  movements: z.array(stockMovementSchema),
});
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;

// POST /admin/products/:id/stock
export const stockAdjustmentResultSchema = z.object({
  product: adminProductSchema,
  movement: stockMovementSchema,
});
export type StockAdjustmentResult = z.infer<typeof stockAdjustmentResultSchema>;
