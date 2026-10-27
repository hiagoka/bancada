import { describe, expect, it } from 'vitest';
import { makeProduct } from '../../test/fixtures';
import { groupByCategory } from './groupByCategory';

describe('groupByCategory', () => {
  it('uma seção por categoria, em ordem alfabética (pt-BR, ignora acento/caixa)', () => {
    const products = [
      makeProduct({ category: 'Mouses', name: 'M1' }),
      makeProduct({ category: 'Áudio', name: 'A1' }),
      makeProduct({ category: 'Casa', name: 'C1' }),
      makeProduct({ category: 'Acessórios', name: 'X1' }),
      makeProduct({ category: 'Teclados', name: 'T1' }),
    ];
    expect(groupByCategory(products).map((g) => g.category)).toEqual([
      'Acessórios',
      'Áudio',
      'Casa',
      'Mouses',
      'Teclados',
    ]);
  });

  it('mantém a ordem da API dentro de cada categoria', () => {
    const a = makeProduct({ category: 'Acessórios', name: 'Hub' });
    const b = makeProduct({ category: 'Acessórios', name: 'Suporte' });
    expect(groupByCategory([a, b])[0]?.products).toEqual([a, b]);
  });

  it('lista vazia -> nenhum grupo', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
