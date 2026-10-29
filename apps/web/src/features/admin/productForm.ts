import {
  adminProductInputSchema,
  type AdminProductInput,
  type AdminProductUpdate,
} from '@bancada/contracts';
import { z } from 'zod';
import { parsePriceToCents } from '../../lib/format';

// As regras e mensagens (PT-BR) dos campos de texto, do preço e do estoque vêm do contracts.
const shape = adminProductInputSchema.shape;

export const PRICE_FORMAT_MESSAGE = 'Preço inválido. Use o formato 349,90.';

// Preço digitado em REAIS ("349,90", "1.349,90") -> centavos inteiros, sem ponto flutuante
// (parsePriceToCents faz a conta com inteiros). A regra "maior que zero" é a do contracts.
const priceField = z
  .string({ error: 'Informe o preço' })
  .trim()
  .min(1, { error: 'Informe o preço' })
  .transform((value, ctx) => {
    const cents = parsePriceToCents(value);
    if (cents === null) {
      ctx.issues.push({ code: 'custom', message: PRICE_FORMAT_MESSAGE, input: value });
      return z.NEVER;
    }
    return cents;
  })
  .pipe(shape.priceCents);

const STOCK_MESSAGE = 'O estoque inicial deve ser um número inteiro, zero ou mais';

const stockField = z
  .string({ error: 'Informe o estoque inicial' })
  .trim()
  .min(1, { error: 'Informe o estoque inicial' })
  .regex(/^\d+$/, { error: STOCK_MESSAGE })
  .transform(Number)
  .pipe(shape.initialStock);

export const createFormSchema = z
  .object({
    name: shape.name,
    description: shape.description,
    category: shape.category,
    price: priceField,
    initialStock: stockField,
  })
  .transform(({ price, ...rest }) => ({ ...rest, priceCents: price }));
export type CreateFormInput = z.input<typeof createFormSchema>;
export type CreateFormValues = z.output<typeof createFormSchema>;

export const editFormSchema = z.object({
  name: shape.name,
  description: shape.description,
  category: shape.category,
  price: priceField,
  active: z.boolean(),
});
export type EditFormInput = z.input<typeof editFormSchema>;
export type EditFormValues = z.output<typeof editFormSchema>;

// Centavos -> texto em reais para o campo de edição ("34990" -> "349,90"), só com inteiros.
export function centsToReais(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${reais},${rest}`;
}

// POST: SÓ os campos do schema estrito (nada de active, stock ou slug). Sem imagem, sem imageKey.
export function toCreateInput(
  values: CreateFormValues,
  imageKey: string | null,
): AdminProductInput {
  return {
    name: values.name,
    description: values.description,
    category: values.category,
    priceCents: values.priceCents,
    initialStock: values.initialStock,
    ...(imageKey ? { imageKey } : {}),
  };
}

// O que o admin quer fazer com a imagem na edição (D16).
export type ImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; key: string };

interface Original {
  name: string;
  description: string;
  category: string;
  priceCents: number;
  active: boolean;
  imageKey: string | null;
}

// PATCH só com o que mudou. imageKey: ausente mantém, null remove, string troca. Sem mudança
// nenhuma devolve null (a API recusa PATCH vazio).
export function buildUpdatePatch(
  original: Original,
  values: EditFormValues,
  image: ImageChange,
): AdminProductUpdate | null {
  const patch: AdminProductUpdate = {};
  if (values.name !== original.name) patch.name = values.name;
  if (values.description !== original.description) patch.description = values.description;
  if (values.category !== original.category) patch.category = values.category;
  if (values.price !== original.priceCents) patch.priceCents = values.price;
  if (values.active !== original.active) patch.active = values.active;
  if (image.kind === 'remove' && original.imageKey !== null) patch.imageKey = null;
  if (image.kind === 'replace' && image.key !== original.imageKey) patch.imageKey = image.key;
  return Object.keys(patch).length === 0 ? null : patch;
}
