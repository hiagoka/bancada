import { describe, expect, it } from 'vitest';
import { makeProduct } from '../../test/fixtures';
import { orderSignature } from './orderSignature';

const a = makeProduct({ stock: 9 });
const b = makeProduct({ stock: 9 });
const customer = { name: 'Ana Souza', email: 'ana@example.com' };

describe('orderSignature', () => {
  it('é igual para o mesmo carrinho e os mesmos dados', () => {
    const lines = [{ product: a, quantity: 2 }];
    expect(orderSignature(lines, customer)).toBe(orderSignature([...lines], { ...customer }));
  });

  it('não depende da ordem das linhas (itens ordenados por productId, como o servidor)', () => {
    const one = [
      { product: a, quantity: 1 },
      { product: b, quantity: 2 },
    ];
    expect(orderSignature(one, customer)).toBe(orderSignature([...one].reverse(), customer));
  });

  it('ignora capitalização e espaços do e-mail e espaços do nome', () => {
    const lines = [{ product: a, quantity: 1 }];
    expect(orderSignature(lines, customer)).toBe(
      orderSignature(lines, { name: '  Ana Souza  ', email: '  ANA@Example.COM ' }),
    );
  });

  it('muda com a quantidade, com o produto, com o nome e com o e-mail', () => {
    const base = orderSignature([{ product: a, quantity: 1 }], customer);
    expect(orderSignature([{ product: a, quantity: 2 }], customer)).not.toBe(base);
    expect(orderSignature([{ product: b, quantity: 1 }], customer)).not.toBe(base);
    expect(orderSignature([{ product: a, quantity: 1 }], { ...customer, name: 'Outra' })).not.toBe(
      base,
    );
    expect(
      orderSignature([{ product: a, quantity: 1 }], { ...customer, email: 'b@example.com' }),
    ).not.toBe(base);
    expect(
      orderSignature(
        [
          { product: a, quantity: 1 },
          { product: b, quantity: 1 },
        ],
        customer,
      ),
    ).not.toBe(base);
  });

  it('não usa o preço: mudar o preço do snapshot não troca a assinatura', () => {
    const base = orderSignature([{ product: a, quantity: 1 }], customer);
    expect(orderSignature([{ product: { ...a, priceCents: 1 }, quantity: 1 }], customer)).toBe(
      base,
    );
  });
});
