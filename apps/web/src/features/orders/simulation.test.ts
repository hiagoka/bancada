import { describe, expect, it } from 'vitest';
import { differentAmount, simulationMessage } from './simulation';

describe('differentAmount (testa a proteção contra valor adulterado)', () => {
  it.each([
    [49800, 48800], // total - 1000
    [1100, 100], // exatamente no limite: 100 >= 100
    [1099, 1199], // total - 1000 < 100: soma 100
    [500, 600],
    [1, 101],
    [100, 200],
  ])('total %d -> %d', (total, expected) => {
    expect(differentAmount(total)).toBe(expected);
  });

  it('sempre devolve um valor DIFERENTE do total, inteiro e positivo', () => {
    for (const total of [1, 99, 100, 1000, 1099, 1100, 1101, 49800, 2_147_483_000]) {
      const value = differentAmount(total);
      expect(value).not.toBe(total);
      expect(Number.isInteger(value) && value > 0).toBe(true);
    }
  });
});

describe('simulationMessage', () => {
  it('aprovado aplicado: sucesso; cancelado aplicado: pedido cancelado', () => {
    expect(simulationMessage('approved', 'applied')).toEqual({
      text: 'Pagamento aprovado.',
      goToOrder: true,
    });
    expect(simulationMessage('cancelled', 'applied')).toEqual({
      text: 'Pedido cancelado.',
      goToOrder: true,
    });
  });

  it("recusado (outcome no_change): 'Pagamento recusado…' e o pedido continua pendente", () => {
    expect(simulationMessage('rejected', 'no_change')).toEqual({
      text: 'Pagamento recusado. O pedido continua aguardando pagamento; você pode tentar de novo.',
      goToOrder: false,
    });
  });

  it('amount_mismatch', () => {
    expect(simulationMessage('approved', 'amount_mismatch')).toEqual({
      text: 'O valor pago não confere com o pedido. O pagamento não foi aceito.',
      goToOrder: false,
    });
  });

  it.each([
    ['approved', 'invalid_transition', /não é permitida/],
    ['approved', 'no_change', /Nada mudou/],
    ['cancelled', 'no_change', /Nada mudou/],
    ['approved', 'duplicate', /já foi registrado/],
    ['approved', 'payment_not_found', /não encontrou o pagamento/],
    ['approved', 'order_not_found', /Pedido não encontrado/],
  ] as const)('%s + %s: mensagem neutra e clara', (action, outcome, pattern) => {
    const { text, goToOrder } = simulationMessage(action, outcome);
    expect(text).toMatch(pattern);
    expect(goToOrder).toBe(false);
  });

  it('outcome desconhecido: mensagem padrão que cita o valor', () => {
    expect(simulationMessage('approved', 'algo_novo').text).toContain('algo_novo');
  });
});
