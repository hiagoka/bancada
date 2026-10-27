import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, statusAnnouncement, trackerSteps } from './orderStatus';

describe('STATUS_LABEL (PT-BR)', () => {
  it('rótulos de cada status', () => {
    expect(STATUS_LABEL).toEqual({
      PENDING: 'Aguardando pagamento',
      PAID: 'Pago',
      CANCELLED: 'Cancelado',
      REFUNDED: 'Estornado',
    });
  });
});

describe('statusAnnouncement', () => {
  it.each([
    ['PENDING', 'Pedido aguardando pagamento.'],
    ['PAID', 'Pagamento confirmado. Seu pedido está pago.'],
    ['CANCELLED', 'Este pedido foi cancelado.'],
    ['REFUNDED', 'O pagamento deste pedido foi estornado.'],
  ] as const)('%s -> %s', (status, text) => {
    expect(statusAnnouncement(status)).toBe(text);
  });
});

describe('trackerSteps: etapas e estado de cada uma (não só por cor)', () => {
  const summary = (status: Parameters<typeof trackerSteps>[0]) =>
    trackerSteps(status).map((s) => `${s.label}:${s.state}`);

  it('PENDING: recebido concluído, pagamento em andamento, confirmado pendente', () => {
    expect(summary('PENDING')).toEqual([
      'Pedido recebido:done',
      'Pagamento:current',
      'Confirmado:upcoming',
    ]);
  });

  it('PAID: tudo concluído (nada em andamento)', () => {
    expect(summary('PAID')).toEqual(['Pedido recebido:done', 'Pagamento:done', 'Confirmado:done']);
  });

  it('CANCELLED: o pagamento não aconteceu e a última etapa não ocorre', () => {
    expect(summary('CANCELLED')).toEqual([
      'Pedido recebido:done',
      'Pagamento:failed',
      'Confirmado:upcoming',
    ]);
  });

  it('REFUNDED: pagamento e confirmação aconteceram; a última etapa indica o estorno', () => {
    expect(summary('REFUNDED')).toEqual([
      'Pedido recebido:done',
      'Pagamento:done',
      'Confirmado:done',
    ]);
    expect(trackerSteps('REFUNDED')[2]?.note).toBe('Estornado');
  });

  it('cada etapa tem um texto de estado legível (leitor de tela)', () => {
    for (const step of trackerSteps('PENDING')) expect(step.stateText.length).toBeGreaterThan(3);
  });
});
