import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCEMENT_LIFETIME_MS, useAnnouncer } from './announcer';

beforeEach(() => {
  vi.useFakeTimers();
  useAnnouncer.setState({ message: '' });
});
afterEach(() => vi.useRealTimers());

describe('announcer', () => {
  it('guarda a mensagem para a região aria-live', () => {
    useAnnouncer.getState().announce('Mouse adicionado ao carrinho.');
    expect(useAnnouncer.getState().message).toBe('Mouse adicionado ao carrinho.');
  });

  it('a mesma mensagem de novo muda o conteúdo (senão o leitor de tela não repete)', () => {
    const { announce } = useAnnouncer.getState();
    announce('Mouse adicionado.');
    const first = useAnnouncer.getState().message;
    announce('Mouse adicionado.');
    const second = useAnnouncer.getState().message;
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first.trim());
  });
});

describe('announcer: a mensagem não fica na região aria-live para sempre', () => {
  it('limpa depois de 2 s (não relê "Criando seu pedido…" fora de contexto na outra página)', () => {
    expect(ANNOUNCEMENT_LIFETIME_MS).toBe(2000);
    useAnnouncer.getState().announce('Criando seu pedido…');
    vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME_MS - 1);
    expect(useAnnouncer.getState().message).toBe('Criando seu pedido…');
    vi.advanceTimersByTime(1);
    expect(useAnnouncer.getState().message).toBe('');
  });

  it('uma mensagem nova NÃO é apagada pelo temporizador da anterior', () => {
    const { announce } = useAnnouncer.getState();
    announce('Criando seu pedido…');
    vi.advanceTimersByTime(1500);
    announce('Pedido criado. Abra o Pix para pagar.');
    vi.advanceTimersByTime(1000); // passou o prazo da primeira, não o da segunda
    expect(useAnnouncer.getState().message).toBe('Pedido criado. Abra o Pix para pagar.');
    vi.advanceTimersByTime(1000);
    expect(useAnnouncer.getState().message).toBe('');
  });

  it('repetir a mesma mensagem reinicia o prazo', () => {
    const { announce } = useAnnouncer.getState();
    announce('Mouse adicionado.');
    vi.advanceTimersByTime(1500);
    announce('Mouse adicionado.');
    vi.advanceTimersByTime(1500);
    expect(useAnnouncer.getState().message.trim()).toBe('Mouse adicionado.');
    vi.advanceTimersByTime(600);
    expect(useAnnouncer.getState().message).toBe('');
  });

  it('não deixa temporizador pendente depois de limpar', () => {
    useAnnouncer.getState().announce('x');
    vi.advanceTimersByTime(ANNOUNCEMENT_LIFETIME_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
