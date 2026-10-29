import { describe, expect, it } from 'vitest';
import {
  buildUpdatePatch,
  centsToReais,
  createFormSchema,
  editFormSchema,
  toCreateInput,
} from './productForm';

const valid = {
  name: ' Teclado Mecânico ',
  description: 'Switch marrom',
  category: 'Teclados',
  price: '349,90',
  initialStock: '10',
};

describe('centsToReais', () => {
  it.each([
    [34990, '349,90'],
    [100, '1,00'],
    [5, '0,05'],
    [100000, '1000,00'],
    [123456, '1234,56'],
  ])('%i -> %s', (cents, text) => {
    expect(centsToReais(cents)).toBe(text);
  });
});

describe('createFormSchema: preço em reais vira centavos inteiros', () => {
  it.each([
    ['349,90', 34990],
    ['349.90', 34990],
    ['1.349,90', 134990],
    ['349', 34900],
    ['0,05', 5],
    ['R$ 10,5', 1050],
    ['19,99', 1999], // 19.99 * 100 daria 1998.9999999999998 em float
    ['0,29', 29],
    ['1,15', 115],
  ])('"%s" -> %i', (price, cents) => {
    const parsed = createFormSchema.parse({ ...valid, price });
    expect(parsed.priceCents).toBe(cents);
    expect(Number.isInteger(parsed.priceCents)).toBe(true);
  });

  it.each([
    ['', 'Informe o preço'],
    ['abc', 'Preço inválido. Use o formato 349,90.'],
    ['12,345', 'Preço inválido. Use o formato 349,90.'],
    ['-5', 'Preço inválido. Use o formato 349,90.'],
    ['1e3', 'Preço inválido. Use o formato 349,90.'],
    ['0', 'O preço deve ser maior que zero'],
    ['0,00', 'O preço deve ser maior que zero'],
    ['99999999999', 'Preço inválido. Use o formato 349,90.'],
  ])('preço "%s" é recusado: %s', (price, message) => {
    const result = createFormSchema.safeParse({ ...valid, price });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it('textos aparados; estoque vira inteiro', () => {
    const parsed = createFormSchema.parse(valid);
    expect(parsed).toEqual({
      name: 'Teclado Mecânico',
      description: 'Switch marrom',
      category: 'Teclados',
      priceCents: 34990,
      initialStock: 10,
    });
  });

  it.each([
    [{ name: '' }, 'Informe o nome do produto'],
    [{ name: 'x'.repeat(121) }, 'O nome deve ter no máximo 120 caracteres'],
    [{ description: '  ' }, 'Informe a descrição do produto'],
    [{ category: '' }, 'Informe a categoria do produto'],
    [{ initialStock: '' }, 'Informe o estoque inicial'],
    [{ initialStock: '-1' }, 'O estoque inicial deve ser um número inteiro, zero ou mais'],
    [{ initialStock: '2,5' }, 'O estoque inicial deve ser um número inteiro, zero ou mais'],
    [{ initialStock: '99999999999' }, 'O estoque inicial é alto demais'],
  ])('mensagens do contracts em PT-BR (%j)', (override, message) => {
    const result = createFormSchema.safeParse({ ...valid, ...override });
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it('estoque 0 é válido', () => {
    expect(createFormSchema.parse({ ...valid, initialStock: '0' }).initialStock).toBe(0);
  });
});

describe('toCreateInput', () => {
  const parsed = createFormSchema.parse(valid);

  it('sem imagem: sem imageKey', () => {
    expect(Object.keys(toCreateInput(parsed, null))).not.toContain('imageKey');
  });

  it('com imagem: imageKey', () => {
    const key = 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png';
    expect(toCreateInput(parsed, key).imageKey).toBe(key);
  });

  it('não leva active nem stock', () => {
    expect(Object.keys(toCreateInput(parsed, null)).sort()).toEqual([
      'category',
      'description',
      'initialStock',
      'name',
      'priceCents',
    ]);
  });
});

describe('editFormSchema e buildUpdatePatch', () => {
  const original = {
    name: 'Teclado',
    description: 'Desc',
    category: 'Teclados',
    priceCents: 34990,
    active: true,
    imageKey: 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png' as string | null,
  };
  const form = (o: Record<string, unknown> = {}) =>
    editFormSchema.parse({
      name: 'Teclado',
      description: 'Desc',
      category: 'Teclados',
      price: '349,90',
      active: true,
      ...o,
    });

  it('nada mudou: patch nulo (não envia PATCH vazio, que a API recusa)', () => {
    expect(buildUpdatePatch(original, form(), { kind: 'keep' })).toBeNull();
  });

  it('só os campos alterados vão no patch', () => {
    expect(
      buildUpdatePatch(original, form({ name: 'Novo', price: '400' }), { kind: 'keep' }),
    ).toEqual({
      name: 'Novo',
      priceCents: 40000,
    });
  });

  it('desativar vai como active false', () => {
    expect(buildUpdatePatch(original, form({ active: false }), { kind: 'keep' })).toEqual({
      active: false,
    });
  });

  it('imagem: manter = ausente, remover = null, trocar = a nova chave (D16)', () => {
    const key = 'products/11111111-1111-4111-8111-111111111111.webp';
    expect(buildUpdatePatch(original, form(), { kind: 'remove' })).toEqual({ imageKey: null });
    expect(buildUpdatePatch(original, form(), { kind: 'replace', key })).toEqual({ imageKey: key });
    expect(
      Object.keys(buildUpdatePatch(original, form({ name: 'N' }), { kind: 'keep' }) ?? {}),
    ).toEqual(['name']);
  });

  it('remover imagem de produto que não tem imagem não gera patch', () => {
    expect(
      buildUpdatePatch({ ...original, imageKey: null }, form(), { kind: 'remove' }),
    ).toBeNull();
  });

  it('o schema de edição não tem estoque nem slug', () => {
    expect(Object.keys(editFormSchema.shape).sort()).toEqual([
      'active',
      'category',
      'description',
      'name',
      'price',
    ]);
  });
});
