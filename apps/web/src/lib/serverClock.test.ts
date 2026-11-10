import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordServerDate, resetServerClock, serverNow } from './serverClock';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
  resetServerClock();
});
afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

describe('serverClock', () => {
  it('sem nenhum Date registrado, serverNow é o relógio local', () => {
    expect(serverNow()).toBe(Date.now());
  });

  it('o relógio local ATRASADO é corrigido pelo header Date do servidor', () => {
    // o servidor diz 12:10:00, o local diz 12:00:00: 10 min de atraso (+500 ms do meio do segundo)
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:10:00.500Z'));
  });

  it('o relógio local ADIANTADO também', () => {
    recordServerDate('Tue, 10 Nov 2026 11:50:00 GMT');
    expect(serverNow()).toBe(Date.parse('2026-11-10T11:50:00.500Z'));
  });

  it('continua andando junto com o relógio local (a diferença é fixa)', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    const first = serverNow();
    vi.advanceTimersByTime(7000);
    expect(serverNow()).toBe(first + 7000);
  });

  it.each([null, '', 'ontem', 'Tue, 99 Foo 2026', 'NaN'])(
    'header inválido (%j) é ignorado',
    (header) => {
      recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
      const before = serverNow();
      recordServerDate(header);
      expect(serverNow()).toBe(before);
    },
  );

  it('o registro mais novo vale (o relógio é reajustado a cada resposta)', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    recordServerDate('Tue, 10 Nov 2026 12:00:05 GMT');
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:00:05.500Z'));
  });
});
