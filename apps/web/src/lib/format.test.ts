import { describe, expect, it } from 'vitest';
import { formatDateTime, formatPrice, parsePriceToCents } from './format';

const NBSP = ' ';

describe('formatPrice', () => {
  it.each([
    [34990, `R$${NBSP}349,90`],
    [134990, `R$${NBSP}1.349,90`],
    [1, `R$${NBSP}0,01`],
    [100, `R$${NBSP}1,00`],
    [0, `R$${NBSP}0,00`],
    [2147483647, `R$${NBSP}21.474.836,47`],
    [27970, `R$${NBSP}279,70`],
  ])('%d centavos -> %s', (cents, expected) => {
    expect(formatPrice(cents)).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, -100])(
    'recusa valor que não é um inteiro não negativo de centavos (%p)',
    (cents) => {
      expect(() => formatPrice(cents)).toThrow(RangeError);
    },
  );
});

describe('formatDateTime', () => {
  it('formata dd/MM/aaaa HH:mm no fuso pedido', () => {
    expect(formatDateTime('2026-10-27T15:30:00.000Z', 'UTC')).toBe('27/10/2026 15:30');
    expect(formatDateTime('2026-10-27T15:30:00.000Z', 'America/Sao_Paulo')).toBe(
      '27/10/2026 12:30',
    );
  });

  it('aceita Date e completa com zeros', () => {
    expect(formatDateTime(new Date('2026-01-05T03:04:00Z'), 'UTC')).toBe('05/01/2026 03:04');
  });

  it('data inválida lança RangeError', () => {
    expect(() => formatDateTime('não é data')).toThrow(RangeError);
  });
});

describe('parsePriceToCents', () => {
  it.each([
    ['349,90', 34990],
    ['1.349,90', 134990],
    ['1349,90', 134990],
    ['349', 34900],
    ['349,9', 34990],
    ['0,01', 1],
    ['0,50', 50],
    ['0', 0],
    ['1.000', 100000],
    ['12.345.678,9', 1234567890],
    ['  349,90  ', 34990],
    ['R$ 349,90', 34990],
    ['R$349,90', 34990],
    ['349.90', 34990],
    ['349.9', 34990],
  ])('aceita %p -> %d', (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it.each([
    '',
    '   ',
    'abc',
    '12abc',
    '1,2,3',
    '1.34,90',
    '12,345',
    ',50',
    '-5',
    '-349,90',
    '+5',
    '1e3',
    '1.349.90',
    '1,349.90',
    '٣٤٩',
    '349,90,',
    'R$',
    '0x10',
    '99999999999',
    '21.474.836,48', // acima do teto de INTEGER (centavos)
  ])('rejeita %p', (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });

  it('não sofre erro de ponto flutuante (19,99 -> 1999; 0,29 -> 29; 1,15 -> 115)', () => {
    expect(parsePriceToCents('19,99')).toBe(1999);
    expect(parsePriceToCents('0,29')).toBe(29);
    expect(parsePriceToCents('1,15')).toBe(115);
  });

  it('é o inverso de formatPrice', () => {
    for (const cents of [1, 99, 100, 34990, 134990, 2147483647]) {
      expect(parsePriceToCents(formatPrice(cents).replace('R$', '').replaceAll(NBSP, ''))).toBe(
        cents,
      );
    }
  });
});
