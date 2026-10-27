import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnouncer } from './announcer';

beforeEach(() => useAnnouncer.setState({ message: '' }));

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
