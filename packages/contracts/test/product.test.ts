import {
  adminProductDetailSchema,
  adminProductInputSchema,
  adminProductsQuerySchema,
  stockAdjustmentResultSchema,
  adminProductSchema,
  adminProductUpdateSchema,
  productSchema,
} from '../src/index.js';
import { isoDate, messagesOf, omit, uuid } from './fixtures.js';

const IMAGE_KEY = 'products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.png';
const IMAGE_KEY_WEBP = 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.webp';

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
    expect(adminProductInputSchema.safeParse({ ...input, imageKey: IMAGE_KEY }).success).toBe(true);
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

  it.each(['stock', 'slug', 'active', 'id', 'createdAt'])(
    'rejeita o campo desconhecido %s em vez de descartá-lo em silêncio',
    (field) => {
      const result = adminProductInputSchema.safeParse({ ...input, [field]: 'x' });
      expect(result.success).toBe(false);
      expect(messagesOf(result).join(' ')).toContain(`Campo não permitido: ${field}`);
    },
  );

  it('rejeita campo obrigatório ausente', () => {
    expect(adminProductInputSchema.safeParse(omit(input, 'category')).success).toBe(false);
  });
});

describe('adminProductUpdateSchema', () => {
  it('rejeita corpo vazio com mensagem em PT-BR', () => {
    const result = adminProductUpdateSchema.safeParse({});
    expect(messagesOf(result)).toContain('Informe ao menos um campo para atualizar');
  });

  it('imageKey ausente continua ausente (mantém a imagem)', () => {
    const parsed = adminProductUpdateSchema.parse({ name: 'Novo' });
    expect('imageKey' in parsed).toBe(false);
  });

  it('imageKey null é preservado (remove a imagem)', () => {
    expect(adminProductUpdateSchema.parse({ imageKey: null })).toEqual({ imageKey: null });
  });

  it('imageKey string é preservado (troca a imagem)', () => {
    expect(adminProductUpdateSchema.parse({ imageKey: IMAGE_KEY_WEBP })).toEqual({
      imageKey: IMAGE_KEY_WEBP,
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

  it.each(['stock', 'initialStock', 'slug', 'id', 'createdAt', 'passwordHash'])(
    'rejeita o campo desconhecido %s (estoque e slug não são alterados pelo PATCH)',
    (field) => {
      const result = adminProductUpdateSchema.safeParse({ name: 'Ok', [field]: 'x' });
      expect(result.success).toBe(false);
      expect(messagesOf(result).join(' ')).toContain('Campo não permitido');
    },
  );
});

describe('formato do imageKey (chave gerada pelo upload, T12)', () => {
  it.each(['jpg', 'png', 'webp'])('aceita products/<uuid>.%s', (ext) => {
    const key = `products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.${ext}`;
    expect(adminProductInputSchema.safeParse({ ...input, imageKey: key }).success).toBe(true);
    expect(adminProductUpdateSchema.safeParse({ imageKey: key }).success).toBe(true);
  });

  it.each([
    'products/a.png',
    'abc',
    '../products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.png',
    'products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.gif',
    'products/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.png/extra',
    'products/3F2504E0-4F89-4D3A-9A0C-0305E82C3301.png',
    'other/3f2504e0-4f89-4d3a-9a0c-0305e82c3301.png',
    'https://evil.example/x.png',
    '',
  ])('rejeita %p com mensagem em PT-BR', (key) => {
    const create = adminProductInputSchema.safeParse({ ...input, imageKey: key });
    const update = adminProductUpdateSchema.safeParse({ imageKey: key });
    expect(messagesOf(create)).toContain('Chave de imagem inválida');
    expect(messagesOf(update)).toContain('Chave de imagem inválida');
  });
});

describe('adminProductsQuerySchema', () => {
  it('aceita vazio, q e active=true|false (convertido para boolean)', () => {
    expect(adminProductsQuerySchema.parse({})).toEqual({});
    expect(adminProductsQuerySchema.parse({ q: ' mouse ', active: 'false' })).toEqual({
      q: 'mouse',
      active: false,
    });
    expect(adminProductsQuerySchema.parse({ active: 'true' })).toEqual({ active: true });
  });

  it.each(['yes', '1', 'TRUE', ''])('rejeita active=%p', (active) => {
    const result = adminProductsQuerySchema.safeParse({ active });
    expect(messagesOf(result)).toContain('O filtro active deve ser "true" ou "false"');
  });

  it('rejeita q muito longo e q repetido (array)', () => {
    expect(adminProductsQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(adminProductsQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(false);
  });
});

describe('adminProductDetailSchema e stockAdjustmentResultSchema', () => {
  const movement = {
    id: 1,
    productId: uuid,
    delta: 5,
    reason: 'restock',
    orderId: null,
    adminId: null,
    note: null,
    stockAfter: 8,
    createdAt: isoDate,
  };

  it('detalhe = produto de admin + movimentações', () => {
    const detail = { ...adminProduct, movements: [movement] };
    expect(adminProductDetailSchema.parse(detail)).toEqual(detail);
    expect(adminProductDetailSchema.safeParse(adminProduct).success).toBe(false);
  });

  it('resultado do ajuste = produto + movimento', () => {
    const result = { product: adminProduct, movement };
    expect(stockAdjustmentResultSchema.parse(result)).toEqual(result);
  });
});
