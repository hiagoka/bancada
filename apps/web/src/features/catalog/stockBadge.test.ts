import { describe, expect, it } from 'vitest';
import { stockBadge } from './stockBadge';

describe('stockBadge', () => {
  it.each([
    [0, 'Esgotado'],
    [-1, 'Esgotado'],
    [1, 'Últimas 1 un.'],
    [2, 'Últimas 2 un.'],
    [3, 'Últimas 3 un.'],
    [4, null],
    [50, null],
  ])('estoque %d -> %s', (stock, label) => {
    expect(stockBadge(stock)).toBe(label);
  });
});
