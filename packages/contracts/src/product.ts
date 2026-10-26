import { z } from 'zod';
import { MAX_INT4 } from './limits.js';

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

const imageKeySchema = z.string({ error: 'A chave da imagem deve ser um texto' });

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

export const adminProductInputSchema = z.object({
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
});
export type AdminProductInput = z.infer<typeof adminProductInputSchema>;

// imageKey: ausente mantém a imagem, null remove, string troca (D16).
// Estoque não é alterado aqui (só via ajuste de estoque).
export const adminProductUpdateSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  category: categorySchema.optional(),
  priceCents: priceCentsSchema.optional(),
  active: z.boolean({ error: 'O campo ativo deve ser verdadeiro ou falso' }).optional(),
  imageKey: imageKeySchema.nullable().optional(),
});
export type AdminProductUpdate = z.infer<typeof adminProductUpdateSchema>;
