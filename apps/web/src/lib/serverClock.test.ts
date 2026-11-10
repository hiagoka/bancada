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

describe('serverClock: respostas que não servem para acertar o relógio', () => {
  it('resposta de cache compartilhado (Age > 5 s) é ignorada: o Date dela é velho', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    const before = serverNow();
    recordServerDate('Tue, 10 Nov 2026 11:00:00 GMT', { age: '120' });
    expect(serverNow()).toBe(before);
  });

  it.each(['6', '5.5', '3600'])('Age %s ignora; ', (age) => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    const before = serverNow();
    recordServerDate('Tue, 10 Nov 2026 12:00:30 GMT', { age });
    expect(serverNow()).toBe(before);
  });

  it.each(['0', '1', '5'])('Age %s (até 5 s) vale', (age) => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { age });
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:10:00.500Z'));
  });

  it.each([null, '', 'abc'])('Age ausente ou ilegível (%j) não impede', (age) => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { age });
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:10:00.500Z'));
  });

  it('metade do RTT entra na conta (o Date foi gerado antes de a resposta chegar)', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { rttMs: 400 });
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:10:00.700Z'));
  });

  it('prefere a resposta de MENOR RTT: uma resposta lenta posterior não desloca o relógio', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { rttMs: 800 });
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { rttMs: 50 }); // melhor: vale
    const best = serverNow();
    expect(best).toBe(Date.parse('2026-11-10T12:10:00.525Z'));
    recordServerDate('Tue, 10 Nov 2026 12:15:00 GMT', { rttMs: 300 }); // pior: ignorada
    expect(serverNow()).toBe(best);
  });

  it('depois de 60 s a estimativa é renovada mesmo com RTT pior (o relógio do aparelho anda)', () => {
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT', { rttMs: 50 });
    vi.advanceTimersByTime(61_000);
    recordServerDate('Tue, 10 Nov 2026 12:11:10 GMT', { rttMs: 300 });
    expect(serverNow()).toBe(Date.parse('2026-11-10T12:11:10.650Z'));
  });
});
