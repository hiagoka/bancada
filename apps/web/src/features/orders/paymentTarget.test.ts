import { describe, expect, it } from 'vitest';
import { PAYMENT_WINDOW_MS, isPaymentWindowOpen, paymentTarget } from './paymentTarget';

const origin = 'http://localhost:5173';
const id = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

describe('paymentTarget (mesma regra segura do checkout)', () => {
  it('mesma origem: navega pelo router', () => {
    expect(paymentTarget(`${origin}/checkout-simulado/${id}`, id, origin)).toEqual({
      kind: 'internal',
      to: `/checkout-simulado/${id}`,
    });
  });

  it('externa https (checkout externo): link externo', () => {
    expect(paymentTarget('https://pagamento.example.com/c/1', id, origin)).toEqual({
      kind: 'external',
      url: 'https://pagamento.example.com/c/1',
    });
  });

  it.each([null, '', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://'])(
    'sem URL usável (%p): null (a página mostra "Estamos preparando o pagamento")',
    (url) => {
      expect(paymentTarget(url, id, origin)).toBeNull();
    },
  );

  it('página em https: http externo é recusado', () => {
    expect(paymentTarget('http://pay.example/x', id, 'https://loja.example.com')).toBeNull();
  });

  it('o próprio /pedido/:id não é um destino de pagamento', () => {
    expect(paymentTarget(`${origin}/pedido/${id}`, id, origin)).toBeNull();
  });
});

describe('isPaymentWindowOpen (D19: a Preference expira 30 min depois de createdAt)', () => {
  const created = '2026-10-27T15:00:00.000Z';
  const at = (minutes: number, extraMs = 0) =>
    new Date(created).getTime() + minutes * 60_000 + extraMs;

  it('janela de 30 minutos', () => {
    expect(PAYMENT_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it('aberta antes dos 30 min e fechada a partir deles', () => {
    expect(isPaymentWindowOpen(created, at(0))).toBe(true);
    expect(isPaymentWindowOpen(created, at(29))).toBe(true);
    expect(isPaymentWindowOpen(created, at(30, -1))).toBe(true);
    expect(isPaymentWindowOpen(created, at(30))).toBe(false);
    expect(isPaymentWindowOpen(created, at(45))).toBe(false);
  });

  it('data inválida: não bloqueia (a API continua sendo a fonte do status)', () => {
    expect(isPaymentWindowOpen('lixo', Date.now())).toBe(true);
  });
});
