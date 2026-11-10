import { describe, expect, it } from 'vitest';
import { ordersHref, parseOrdersParams } from './ordersParams';

const parse = (query: string) => parseOrdersParams(new URLSearchParams(query));

describe('parseOrdersParams', () => {
  it('sem parâmetros: todos os status, página 1', () => {
    expect(parse('')).toEqual({ status: 'all', page: 1 });
  });

  it.each(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'])('status %s válido', (status) => {
    expect(parse(`status=${status}`).status).toBe(status);
  });

  it.each([
    ['status=paid'],
    ['status=XYZ'],
    ['status='],
    ['status=PAID,PENDING'],
    ['status=<script>'],
  ])('status inválido (%s) vira "all"', (query) => {
    expect(parse(query).status).toBe('all');
  });

  it.each([
    ['page=3', 3],
    ['page=1', 1],
    ['page=0', 1],
    ['page=-2', 1],
    ['page=2.5', 1],
    ['page=abc', 1],
    ['page=', 1],
    ['page=1e3', 1],
    ['page=99999999', 1],
  ])('%s -> página %i', (query, page) => {
    expect(parse(query).page).toBe(page);
  });
});

describe('ordersHref', () => {
  it('monta a URL só com o que difere do padrão', () => {
    expect(ordersHref({ status: 'all', page: 1 })).toBe('/admin/pedidos');
    expect(ordersHref({ status: 'PAID', page: 1 })).toBe('/admin/pedidos?status=PAID');
    expect(ordersHref({ status: 'all', page: 2 })).toBe('/admin/pedidos?page=2');
    expect(ordersHref({ status: 'CANCELLED', page: 3 })).toBe(
      '/admin/pedidos?status=CANCELLED&page=3',
    );
  });
});
