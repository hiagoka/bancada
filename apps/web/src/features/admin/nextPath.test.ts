import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_PATH, loginUrl, sanitizeNext } from './nextPath';

describe('sanitizeNext (anti open redirect)', () => {
  it.each([
    ['/admin/produtos', '/admin/produtos'],
    ['/admin/pedidos?status=PAID&page=2', '/admin/pedidos?status=PAID&page=2'],
    [
      '/admin/produtos/6ba7b810-9dad-41d1-80b5-00c04fd430c8',
      '/admin/produtos/6ba7b810-9dad-41d1-80b5-00c04fd430c8',
    ],
    ['/admin', '/admin'],
    ['/admin?x=1', '/admin?x=1'],
  ])('aceita %s', (input, expected) => {
    expect(sanitizeNext(input)).toBe(expected);
  });

  it.each([
    ['//evil.com'],
    ['//evil.com/admin'],
    ['///admin'],
    ['https://evil.com'],
    ['https://evil.com/admin/produtos'],
    ['http://localhost:5173/admin/produtos'],
    ['/\\evil.com'],
    ['/admin\\..\\evil'],
    ['\\\\evil.com'],
    ['/admin/../x'],
    ['/admin/./produtos/../../x'],
    ['/admin/%2e%2e/x'],
    ['/admin/%2E%2E%2fx'],
    ['/admin/%5cevil.com'],
    ['javascript:alert(1)'],
    ['data:text/html,<b>x</b>'],
    ['/admin/\nfoo'],
    ['/admin/\tfoo'],
    ['/admin/\u0000'],
    ['/admin/%0d%0aSet-Cookie:x'],
    ['/administrador'],
    ['/adminx/produtos'],
    ['/'],
    ['/pedido/1'],
    ['admin/produtos'],
    ['/admin/login'],
    ['/admin/login?next=/admin/produtos'],
    [''],
    ['   '],
    ['/admin/' + 'a'.repeat(3000)],
  ])('rejeita %j', (input) => {
    expect(sanitizeNext(input)).toBe(DEFAULT_ADMIN_PATH);
  });

  it.each([[null], [undefined]])('rejeita %s', (input) => {
    expect(sanitizeNext(input)).toBe(DEFAULT_ADMIN_PATH);
  });

  it('o destino padrão é /admin/produtos', () => {
    expect(DEFAULT_ADMIN_PATH).toBe('/admin/produtos');
  });

  it('descarta o fragmento', () => {
    expect(sanitizeNext('/admin/produtos#x')).toBe('/admin/produtos');
  });
});

describe('loginUrl', () => {
  it('codifica o caminho pedido (com query)', () => {
    expect(loginUrl('/admin/pedidos', '?status=PAID')).toBe(
      '/admin/login?next=%2Fadmin%2Fpedidos%3Fstatus%3DPAID',
    );
  });
});
