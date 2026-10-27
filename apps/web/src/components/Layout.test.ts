import { describe, expect, it } from 'vitest';
import { itemsLabel } from './Layout';

describe('itemsLabel (leitor de tela do contador do carrinho)', () => {
  it.each([
    [0, '0 itens no carrinho'],
    [1, '1 item no carrinho'],
    [2, '2 itens no carrinho'],
  ])('%d -> %s', (count, label) => {
    expect(itemsLabel(count)).toBe(label);
  });
});
