import { describe, expect, it } from 'vitest';
import { fnv1a64Hex } from './hash';

describe('fnv1a64Hex (hash próprio: crypto.subtle não existe em HTTP fora de localhost)', () => {
  it.each([
    ['', 'cbf29ce484222325'],
    ['a', 'af63dc4c8601ec8c'],
    ['foobar', '85944171f73967e8'],
  ])('vetores de teste conhecidos do FNV-1a 64: %p -> %s', (input, expected) => {
    expect(fnv1a64Hex(input)).toBe(expected);
  });

  it('é determinístico, tem 16 dígitos hex e diferencia entradas parecidas', () => {
    const a = fnv1a64Hex('{"email":"ana@example.com"}');
    expect(fnv1a64Hex('{"email":"ana@example.com"}')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex('{"email":"ana@example.org"}')).not.toBe(a);
  });

  it('aceita acentos e emoji (UTF-8)', () => {
    expect(fnv1a64Hex('João ✓')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex('João')).not.toBe(fnv1a64Hex('Joao'));
  });
});
