import { describe, expect, it } from 'vitest';
import { resolveRedirect } from './redirect';

const origin = 'http://localhost:5173';
const id = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

describe('resolveRedirect', () => {
  it('mesma origem (modo fake): navega pelo router com pathname + search + hash', () => {
    expect(resolveRedirect(`${origin}/checkout-simulado/${id}`, id, origin)).toEqual({
      kind: 'internal',
      to: `/checkout-simulado/${id}`,
    });
    expect(resolveRedirect(`${origin}/pedido/${id}?a=1#topo`, id, origin)).toEqual({
      kind: 'internal',
      to: `/pedido/${id}?a=1#topo`,
    });
  });

  it('página em https: URL externa só se for https (http é recusado)', () => {
    expect(resolveRedirect('http://pay.example/x', id, 'https://loja.example.com')).toEqual({
      kind: 'internal',
      to: `/pedido/${id}`,
    });
    expect(resolveRedirect('https://pay.example/x', id, 'https://loja.example.com')).toEqual({
      kind: 'external',
      url: 'https://pay.example/x',
    });
  });

  it('URL externa http(s) (checkout externo): redirecionamento externo', () => {
    expect(
      resolveRedirect('https://pagamento.example.com/checkout/redirect?ref=1', id, origin),
    ).toEqual({
      kind: 'external',
      url: 'https://pagamento.example.com/checkout/redirect?ref=1',
    });
    expect(resolveRedirect('http://sandbox.test/pay', id, origin)).toEqual({
      kind: 'external',
      url: 'http://sandbox.test/pay',
    });
  });

  it.each([null, undefined, ''])('sem checkoutUrl (%p): vai para /pedido/:id', (url) => {
    expect(resolveRedirect(url, id, origin)).toEqual({ kind: 'internal', to: `/pedido/${id}` });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:http://x/1',
    'ftp://x/y',
  ])(
    'esquema perigoso/não-http (%s): NUNCA vira redirecionamento externo; cai em /pedido/:id',
    (url) => {
      expect(resolveRedirect(url, id, origin)).toEqual({ kind: 'internal', to: `/pedido/${id}` });
    },
  );

  it('lixo que não é URL: cai em /pedido/:id', () => {
    expect(resolveRedirect('http://', id, origin)).toEqual({
      kind: 'internal',
      to: `/pedido/${id}`,
    });
  });

  it('caminho relativo é resolvido contra a origem do web (interno)', () => {
    expect(resolveRedirect('/checkout-simulado/abc', id, origin)).toEqual({
      kind: 'internal',
      to: '/checkout-simulado/abc',
    });
  });

  it('URL com credenciais embutidas (user:pass@) não é seguida como externa', () => {
    expect(resolveRedirect('https://user:senha@evil.example/x', id, origin)).toEqual({
      kind: 'internal',
      to: `/pedido/${id}`,
    });
  });
});
