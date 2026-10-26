import {
  createOrderInputSchema,
  orderSchema,
  orderStatusSchema,
  publicOrderSchema,
} from '../src/index.js';
import { isoDate, messagesOf, omit, uuid, uuid2 } from './fixtures.js';

const item = {
  productId: uuid,
  productName: 'Teclado',
  unitPriceCents: 1000,
  quantity: 2,
};

const publicOrder = {
  id: uuid2,
  status: 'PENDING',
  items: [item],
  totalCents: 2000,
  checkoutUrl: 'https://pay.example/abc',
  paidAt: null,
  createdAt: isoDate,
};

describe('orderStatusSchema', () => {
  it.each(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'])('aceita %s', (s) => {
    expect(orderStatusSchema.safeParse(s).success).toBe(true);
  });

  it('rejeita status desconhecido', () => {
    expect(orderStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('createOrderInputSchema', () => {
  const valid = {
    customer: { name: 'Ana', email: 'ana@example.com' },
    items: [{ productId: uuid, quantity: 2 }],
  };

  it('aceita pedido válido', () => {
    expect(createOrderInputSchema.parse(valid)).toEqual(valid);
  });

  it('descarta qualquer preço enviado pelo cliente', () => {
    const parsed = createOrderInputSchema.parse({
      ...valid,
      totalCents: 1,
      items: [{ productId: uuid, quantity: 2, priceCents: 1, unitPriceCents: 1 }],
    });
    expect(parsed).toEqual(valid);
    expect(parsed.items[0]).not.toHaveProperty('priceCents');
    expect(parsed.items[0]).not.toHaveProperty('unitPriceCents');
    expect(parsed).not.toHaveProperty('totalCents');
  });

  it('rejeita e-mail inválido com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      customer: { name: 'Ana', email: 'nao-e-email' },
    });
    expect(messagesOf(result)).toContain('Informe um e-mail válido');
  });

  it('rejeita nome vazio com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      customer: { name: '', email: 'ana@example.com' },
    });
    expect(messagesOf(result)).toContain('Informe seu nome');
  });

  it('rejeita lista de itens vazia com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({ ...valid, items: [] });
    expect(messagesOf(result)).toContain('O pedido precisa ter ao menos um item');
  });

  it.each([0, -1, 1.5])('rejeita quantidade %p', (quantity) => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      items: [{ productId: uuid, quantity }],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita quantidade 0 com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      items: [{ productId: uuid, quantity: 0 }],
    });
    expect(messagesOf(result)).toContain('A quantidade deve ser maior que zero');
  });

  it('rejeita productId que não é UUID', () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      items: [{ productId: '123', quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita corpo sem customer com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({ items: valid.items });
    expect(messagesOf(result)).toContain('Informe os dados do cliente');
  });

  it('rejeita item que não é objeto e corpo que não é objeto com mensagem em PT-BR', () => {
    expect(messagesOf(createOrderInputSchema.safeParse({ ...valid, items: [null] }))).toContain(
      'Item inválido',
    );
    expect(messagesOf(createOrderInputSchema.safeParse('x'))).toContain('Corpo do pedido inválido');
  });

  it('rejeita quantidade acima do teto com mensagem em PT-BR', () => {
    const result = createOrderInputSchema.safeParse({
      ...valid,
      items: [{ productId: uuid, quantity: 1000 }],
    });
    expect(messagesOf(result)).toContain('A quantidade máxima por item é 999');
  });
});

describe('publicOrderSchema', () => {
  it('aceita pedido público válido', () => {
    expect(publicOrderSchema.parse(publicOrder)).toEqual(publicOrder);
  });

  it('aceita checkoutUrl nulo e paidAt preenchido', () => {
    const paid = { ...publicOrder, status: 'PAID', checkoutUrl: null, paidAt: isoDate };
    expect(publicOrderSchema.safeParse(paid).success).toBe(true);
  });

  it('omite customer, e-mail e nome ao analisar um pedido completo', () => {
    const parsed = publicOrderSchema.parse({
      ...publicOrder,
      customer: { name: 'Ana', email: 'ana@example.com' },
      customerName: 'Ana',
      customerEmail: 'ana@example.com',
    });
    expect(parsed).not.toHaveProperty('customer');
    expect(parsed).not.toHaveProperty('customerName');
    expect(parsed).not.toHaveProperty('customerEmail');
    expect(JSON.stringify(parsed)).not.toContain('ana@example.com');
  });

  it('não declara nenhum campo do cliente no shape', () => {
    expect(Object.keys(publicOrderSchema.shape).sort()).toEqual(
      ['checkoutUrl', 'createdAt', 'id', 'items', 'paidAt', 'status', 'totalCents'].sort(),
    );
  });

  it('rejeita status e total inválidos', () => {
    expect(publicOrderSchema.safeParse({ ...publicOrder, status: 'X' }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...publicOrder, totalCents: 0 }).success).toBe(false);
  });

  it('rejeita checkoutUrl ausente (deve ser string ou null)', () => {
    expect(publicOrderSchema.safeParse(omit(publicOrder, 'checkoutUrl')).success).toBe(false);
  });
});

describe('orderSchema', () => {
  const full = {
    ...publicOrder,
    customer: { name: 'Ana', email: 'ana@example.com' },
    cancellable: false,
  };

  it('aceita pedido completo com cancellable', () => {
    expect(orderSchema.parse(full)).toEqual(full);
  });

  it('exige customer e cancellable booleano', () => {
    expect(orderSchema.safeParse(omit(full, 'customer')).success).toBe(false);
    expect(orderSchema.safeParse({ ...full, cancellable: 'sim' }).success).toBe(false);
    expect(orderSchema.safeParse(omit(full, 'cancellable')).success).toBe(false);
  });
});
