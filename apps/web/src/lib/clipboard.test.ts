// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

const original = {
  clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
  execCommand: Object.getOwnPropertyDescriptor(document, 'execCommand'),
};

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}
function setExecCommand(value: unknown): void {
  Object.defineProperty(document, 'execCommand', { value, configurable: true });
}

afterEach(() => {
  if (original.clipboard) Object.defineProperty(navigator, 'clipboard', original.clipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (original.execCommand) Object.defineProperty(document, 'execCommand', original.execCommand);
  else Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('usa navigator.clipboard.writeText e devolve true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('00020101')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('00020101');
  });

  it('writeText recusado (permissão negada): cai no fallback e, se ele copiar, devolve true', async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new DOMException('negado', 'NotAllowedError')),
    });
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);
    await expect(copyText('abc')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('sem navigator.clipboard (HTTP em IP de rede): usa o fallback', async () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);
    await expect(copyText('abc')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('o fallback usa um <textarea> temporário com o texto e o REMOVE, devolvendo o foco', async () => {
    setClipboard(undefined);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    let selected = '';
    setExecCommand(
      vi.fn(() => {
        const area = document.querySelector('textarea');
        selected = area ? area.value.slice(area.selectionStart, area.selectionEnd) : '';
        return true;
      }),
    );
    await copyText('codigo-pix-123');
    expect(selected).toBe('codigo-pix-123');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('o textarea do fallback NÃO é aria-hidden (recebe foco) e a seleção usa setSelectionRange (iOS)', async () => {
    setClipboard(undefined);
    const observed: { ariaHidden: string | null; start: number; end: number } = {
      ariaHidden: 'não observado',
      start: -1,
      end: -1,
    };
    const setRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
    setExecCommand(
      vi.fn(() => {
        const area = document.querySelector('textarea');
        observed.ariaHidden = area?.getAttribute('aria-hidden') ?? null;
        observed.start = area?.selectionStart ?? -1;
        observed.end = area?.selectionEnd ?? -1;
        return true;
      }),
    );
    await copyText('codigo-pix-123');
    expect(observed.ariaHidden).toBeNull();
    expect(setRange).toHaveBeenCalledWith(0, 'codigo-pix-123'.length);
    expect([observed.start, observed.end]).toEqual([0, 'codigo-pix-123'.length]);
  });

  it('o fallback também falhando: devolve false, sem lançar e sem sobrar <textarea>', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('x')) });
    setExecCommand(vi.fn().mockReturnValue(false));
    await expect(copyText('abc')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('execCommand que lança: devolve false', async () => {
    setClipboard(undefined);
    setExecCommand(
      vi.fn(() => {
        throw new Error('boom');
      }),
    );
    await expect(copyText('abc')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('sem nenhum dos dois meios: devolve false', async () => {
    setClipboard(undefined);
    Reflect.deleteProperty(document, 'execCommand');
    await expect(copyText('abc')).resolves.toBe(false);
  });
});
