// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordServerDate, resetServerClock } from '../../lib/serverClock';
import { formatCountdown, usePixCountdown } from './usePixCountdown';

const START = new Date('2026-11-10T12:00:00.000Z');
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetServerClock();
});
afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

const tick = (seconds: number) => act(() => void vi.advanceTimersByTime(seconds * 1000));

describe('formatCountdown', () => {
  it.each([
    [1800, '30:00'],
    [754, '12:34'],
    [60, '01:00'],
    [59, '00:59'],
    [5, '00:05'],
    [0, '00:00'],
    [-3, '00:00'],
    [3599, '59:59'],
    [3600, '60:00'],
  ])('%i s -> %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text);
  });
});

describe('usePixCountdown', () => {
  it('começa com o tempo restante e desce de 1 em 1 s', () => {
    const { result } = renderHook(() => usePixCountdown(at(125)));
    expect(result.current.remainingSeconds).toBe(125);
    expect(result.current.display).toBe('02:05');
    tick(1);
    expect(result.current.remainingSeconds).toBe(124);
    tick(4);
    expect(result.current.display).toBe('02:00');
  });

  it('chega a zero, fica em zero e marca expired', () => {
    const { result } = renderHook(() => usePixCountdown(at(3)));
    expect(result.current.expired).toBe(false);
    tick(3);
    expect(result.current.remainingSeconds).toBe(0);
    expect(result.current.expired).toBe(true);
    tick(10);
    expect(result.current.remainingSeconds).toBe(0);
    expect(result.current.display).toBe('00:00');
  });

  it('já vencido ao montar: zero e expired desde o começo', () => {
    const { result } = renderHook(() => usePixCountdown(at(-90)));
    expect(result.current.expired).toBe(true);
    expect(result.current.display).toBe('00:00');
  });

  it('arredonda para CIMA (nunca mostra 00:00 enquanto ainda falta um pedaço de segundo)', () => {
    const { result } = renderHook(() => usePixCountdown(at(0.4)));
    expect(result.current.remainingSeconds).toBe(1);
    expect(result.current.expired).toBe(false);
  });

  it('usa o RELÓGIO DO SERVIDOR: aparelho 10 min atrasado não faz o Pix parecer vivo', () => {
    // o servidor diz que agora é 12:10:00; o aparelho diz 12:00:00. O Pix vence às 12:10:30 (servidor).
    recordServerDate('Tue, 10 Nov 2026 12:10:00 GMT');
    const { result } = renderHook(() => usePixCountdown('2026-11-10T12:10:30.000Z'));
    expect(result.current.remainingSeconds).toBe(30); // sem a correção seriam 630 s
  });

  it('aparelho ADIANTADO: o Pix não aparece vencido antes da hora', () => {
    recordServerDate('Tue, 10 Nov 2026 11:50:00 GMT');
    const { result } = renderHook(() => usePixCountdown('2026-11-10T11:50:30.000Z'));
    expect(result.current.remainingSeconds).toBe(30);
  });

  it('limpa o intervalo ao desmontar', () => {
    const { unmount } = renderHook(() => usePixCountdown(at(100)));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('trocar o expiresAt recalcula (pedido novo na mesma tela)', () => {
    const { result, rerender } = renderHook(({ at: iso }) => usePixCountdown(iso), {
      initialProps: { at: at(100) },
    });
    expect(result.current.remainingSeconds).toBe(100);
    rerender({ at: at(500) });
    expect(result.current.remainingSeconds).toBe(500);
  });
});

describe('usePixCountdown: anúncios para leitor de tela (poucos, não a cada segundo)', () => {
  it('não anuncia nada ao montar nem a cada segundo', () => {
    const { result } = renderHook(() => usePixCountdown(at(1800)));
    expect(result.current.announcement).toBe('');
    tick(1);
    tick(1);
    expect(result.current.announcement).toBe('');
  });

  it('anuncia a CADA MINUTO que passa', () => {
    const { result } = renderHook(() => usePixCountdown(at(185)));
    tick(5); // faltam 180 s
    expect(result.current.announcement).toBe('Faltam 3 minutos para o Pix expirar.');
    tick(60);
    expect(result.current.announcement).toBe('Faltam 2 minutos para o Pix expirar.');
    tick(60);
    expect(result.current.announcement).toBe('Faltam 1 minuto para o Pix expirar.');
  });

  it('o número de anúncios por minuto é UM (não repete entre as viradas)', () => {
    const { result } = renderHook(() => usePixCountdown(at(125)));
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      tick(1);
      if (result.current.announcement) seen.add(result.current.announcement);
    }
    // 125 s -> 25 s restantes: só a virada para 2 minutos e para 1 minuto
    expect([...seen]).toEqual([
      'Faltam 2 minutos para o Pix expirar.',
      'Faltam 1 minuto para o Pix expirar.',
    ]);
  });

  it('nos últimos 10 s anuncia UMA vez e ao zerar avisa que o tempo acabou', () => {
    const { result } = renderHook(() => usePixCountdown(at(15)));
    tick(5);
    expect(result.current.announcement).toBe('Faltam 10 segundos para o Pix expirar.');
    tick(4);
    expect(result.current.announcement).toBe('Faltam 10 segundos para o Pix expirar.'); // sem novo anúncio a cada segundo
    tick(6);
    expect(result.current.announcement).toBe('O tempo para pagar o Pix acabou.');
  });

  it('já vencido ao montar: anuncia que acabou (uma vez)', () => {
    const { result } = renderHook(() => usePixCountdown(at(-1)));
    expect(result.current.announcement).toBe('O tempo para pagar o Pix acabou.');
  });

  it('se o aparelho dormiu e vários marcos passaram de uma vez, anuncia só o mais recente', () => {
    const { result } = renderHook(() => usePixCountdown(at(400)));
    act(() => {
      vi.setSystemTime(new Date(START.getTime() + 345_000)); // pulou de 400 s para 55 s restantes
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remainingSeconds).toBeLessThanOrEqual(55);
    expect(result.current.announcement).toMatch(/^Faltam 1 minuto/);
  });
});
