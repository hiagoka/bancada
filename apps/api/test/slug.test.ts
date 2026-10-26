import { slugify } from '../src/shared/slug.js';

describe('slugify', () => {
  it.each([
    ['Teclado Mecânico', 'teclado-mecanico'],
    ['Suporte de Monitor', 'suporte-de-monitor'],
    ['  Hub USB-C 7 em 1  ', 'hub-usb-c-7-em-1'],
    ['Caneca "Dev" (350ml)!', 'caneca-dev-350ml'],
    ['Ação & Reação', 'acao-reacao'],
    ['A---B___C', 'a-b-c'],
    ['ÇÃÕ ÉÊ', 'cao-ee'],
  ])('%p -> %p', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('devolve string vazia quando não sobra nada', () => {
    expect(slugify('!!!')).toBe('');
  });
});
