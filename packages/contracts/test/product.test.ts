import {
  adminProductInputSchema,
  adminProductSchema,
  adminProductUpdateSchema,
  productSchema,
} from '../src/index.js';
import { isoDate, messagesOf, omit, uuid } from './fixtures.js';

const publicProduct = {
  id: uuid,
  slug: 'teclado-mecanico',
  name: 'Teclado mecânico',
  description: 'Switch marrom',
  category: 'teclados',
  priceCents: 59900,
  stock: 3,
  imageUrl: null,
};

const adminProduct = {
  ...publicProduct,
  active: true,
  imageKey: 'products/abc.png',
  createdAt: isoDate,
  updatedAt: isoDate,
};

const input = {
  name: 'Teclado mecânico',
  description: 'Switch marrom',
  category: 'teclados',
  priceCents: 59900,
  initialStock: 5,
};

describe('productSchema', () => {
  it('aceita produto público válido', () => {
    expect(productSchema.parse(publicProduct)).toEqual(publicProduct);
  });

  it('aceita imageUrl como string', () => {
    expect(productSchema.safeParse({ ...publicProduct, imageUrl: 'http://x/y.png' }).success).toBe(
      true,
    );
  });

  it('não expõe campos administrativos', () => {
    const parsed = productSchema.parse({ ...publicProduct, imageKey: 'k', active: true });
    expect(parsed).not.toHaveProperty('imageKey');
    expect(parsed).not.toHaveProperty('active');
  });

  it.each([0, -1, 10.5, '100'])('rejeita preço inválido %p', (priceCents) => {
    expect(productSchema.safeParse({ ...publicProduct, priceCents }).success).toBe(false);
  });

  it('rejeita id que não é UUID', () => {
    expect(productSchema.safeParse({ ...publicProduct, id: 'abc' }).success).toBe(false);
  });
});

describe('adminProductSchema', () => {
  it('aceita produto de admin válido, com imageKey nula', () => {
    expect(adminProductSchema.parse(adminProduct)).toEqual(adminProduct);
    expect(adminProductSchema.safeParse({ ...adminProduct, imageKey: null }).success).toBe(true);
  });

  it('exige active', () => {
    expect(adminProductSchema.safeParse(omit(adminProduct, 'active')).success).toBe(false);
  });
});

describe('adminProductInputSchema', () => {
  it('aceita entrada válida com e sem imageKey', () => {
    expect(adminProductInputSchema.safeParse(input).success).toBe(true);
    expect(
      adminProductInputSchema.safeParse({ ...input, imageKey: 'products/a.png' }).success,
    ).toBe(true);
  });

  it('aceita estoque inicial 0', () => {
    expect(adminProductInputSchema.safeParse({ ...input, initialStock: 0 }).success).toBe(true);
  });

  it('rejeita nome vazio com mensagem em PT-BR', () => {
    const result = adminProductInputSchema.safeParse({ ...input, name: '' });
    expect(messagesOf(result)).toContain('Informe o nome do produto');
  });

  it('rejeita preço zero, negativo e fracionado com mensagem em PT-BR', () => {
    for (const priceCents of [0, -5, 1.5]) {
      const result = adminProductInputSchema.safeParse({ ...input, priceCents });
      expect(result.success).toBe(false);
      expect(messagesOf(result).join(' ')).toMatch(/preço|centavos/i);
    }
  });

  it('rejeita preço e estoque inicial acima do teto do INTEGER do banco', () => {
    const preco = adminProductInputSchema.safeParse({ ...input, priceCents: 3_000_000_000 });
    expect(messagesOf(preco)).toContain('O preço é alto demais');
    const estoque = adminProductInputSchema.safeParse({ ...input, initialStock: 3_000_000_000 });
    expect(messagesOf(estoque)).toContain('O estoque inicial é alto demais');
    expect(adminProductUpdateSchema.safeParse({ priceCents: 3_000_000_000 }).success).toBe(false);
  });

  it('rejeita estoque inicial negativo ou fracionado', () => {
    expect(adminProductInputSchema.safeParse({ ...input, initialStock: -1 }).success).toBe(false);
    expect(adminProductInputSchema.safeParse({ ...input, initialStock: 1.2 }).success).toBe(false);
  });

  it('rejeita campo obrigatório ausente', () => {
    expect(adminProductInputSchema.safeParse(omit(input, 'category')).success).toBe(false);
  });
});

describe('adminProductUpdateSchema', () => {
  it('aceita objeto vazio', () => {
    expect(adminProductUpdateSchema.parse({})).toEqual({});
  });

  it('imageKey ausente continua ausente (mantém a imagem)', () => {
    const parsed = adminProductUpdateSchema.parse({ name: 'Novo' });
    expect('imageKey' in parsed).toBe(false);
  });

  it('imageKey null é preservado (remove a imagem)', () => {
    expect(adminProductUpdateSchema.parse({ imageKey: null })).toEqual({ imageKey: null });
  });

  it('imageKey string é preservado (troca a imagem)', () => {
    expect(adminProductUpdateSchema.parse({ imageKey: 'products/b.webp' })).toEqual({
      imageKey: 'products/b.webp',
    });
  });

  it('rejeita imageKey de outro tipo', () => {
    expect(adminProductUpdateSchema.safeParse({ imageKey: 5 }).success).toBe(false);
  });

  it('aceita active e preço, e valida o preço', () => {
    expect(adminProductUpdateSchema.safeParse({ active: false, priceCents: 100 }).success).toBe(
      true,
    );
    expect(adminProductUpdateSchema.safeParse({ priceCents: 0 }).success).toBe(false);
  });

  it('ignora initialStock (estoque não é alterado pelo PATCH)', () => {
    expect(adminProductUpdateSchema.parse({ initialStock: 9 })).toEqual({});
  });
});
