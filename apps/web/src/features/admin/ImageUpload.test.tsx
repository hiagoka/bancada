// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload, type ImageUploadState } from './ImageUpload';
import { UploadError } from './uploadImage';

const KEY = 'products/6ba7b810-9dad-41d1-80b5-00c04fd430c8.png';
const user = userEvent.setup({ applyAccept: false });

const png = (size = 1000, name = 'foto.png', type = 'image/png') => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

let states: ImageUploadState[];
const onChange = (state: ImageUploadState) => states.push(state);
const last = () => states.at(-1);

beforeEach(() => {
  states = [];
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const input = () => screen.getByLabelText('Imagem do produto') as HTMLInputElement;

describe('ImageUpload', () => {
  it('estado inicial: mantém a imagem atual (keep) e mostra-a', () => {
    render(<ImageUpload currentUrl="http://s3/atual.png" onChange={onChange} upload={vi.fn()} />);
    expect(screen.getByAltText('Imagem atual do produto').getAttribute('src')).toBe(
      'http://s3/atual.png',
    );
    expect(input().getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
    expect(screen.getByRole('button', { name: 'Remover imagem' })).toBeTruthy();
  });

  it('sem imagem atual: sem prévia e sem botão de remover', () => {
    render(<ImageUpload currentUrl={null} onChange={onChange} upload={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover imagem' })).toBeNull();
  });

  it('arquivo válido: prévia, progresso e, ao terminar, replace com a key', async () => {
    let finish!: (key: string) => void;
    let report!: (percent: number) => void;
    const upload = vi.fn(
      (_file: File, onProgress: (p: number) => void) =>
        new Promise<string>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    render(<ImageUpload currentUrl={null} onChange={onChange} upload={upload} />);
    await user.upload(input(), png());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Pré-visualização da nova imagem').getAttribute('src')).toBe(
      'blob:preview',
    );
    expect(last()).toEqual({ change: { kind: 'keep' }, uploading: true });

    act(() => report(45));
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByText('Enviando… 45%')).toBeTruthy();

    await act(async () => finish(KEY));
    await waitFor(() =>
      expect(last()).toEqual({ change: { kind: 'replace', key: KEY }, uploading: false }),
    );
    expect(screen.getByText(/Imagem enviada\./)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it.each([
    [png(1000, 'a.gif', 'image/gif'), 'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP.'],
    [png(2 * 1024 * 1024 + 1), 'A imagem deve ter no máximo 2 MB.'],
    [png(0), 'O arquivo está vazio.'],
  ])('arquivo inválido: erro em role=alert e NADA é enviado', async (file, message) => {
    const upload = vi.fn();
    render(<ImageUpload currentUrl={null} onChange={onChange} upload={upload} />);
    await user.upload(input(), file);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(upload).not.toHaveBeenCalled();
    expect(states).toEqual([]); // nada mudou para o formulário
    expect(input().getAttribute('aria-describedby')).toBeTruthy();
  });

  it('falha no envio: mensagem, mantém a imagem atual e permite tentar de novo', async () => {
    const upload = vi.fn().mockRejectedValueOnce(new UploadError()).mockResolvedValueOnce(KEY);
    render(<ImageUpload currentUrl="http://s3/atual.png" onChange={onChange} upload={upload} />);
    await user.upload(input(), png());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível enviar a imagem',
    );
    expect(last()).toEqual({ change: { kind: 'keep' }, uploading: false });
    expect(screen.getByAltText('Imagem atual do produto')).toBeTruthy();
    await user.upload(input(), png(500, 'outra.png'));
    await waitFor(() => expect(last()?.change).toEqual({ kind: 'replace', key: KEY }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Remover imagem" marca remove e "Desfazer" volta a manter', async () => {
    render(<ImageUpload currentUrl="http://s3/atual.png" onChange={onChange} upload={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Remover imagem' }));
    expect(last()).toEqual({ change: { kind: 'remove' }, uploading: false });
    expect(screen.getByText('A imagem será removida quando você salvar.')).toBeTruthy();
    expect(screen.queryByAltText('Imagem atual do produto')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(last()).toEqual({ change: { kind: 'keep' }, uploading: false });
    expect(screen.getByAltText('Imagem atual do produto')).toBeTruthy();
  });

  it('depois de enviar uma nova imagem, "Descartar nova imagem" volta ao estado anterior', async () => {
    const upload = vi.fn().mockResolvedValue(KEY);
    render(<ImageUpload currentUrl="http://s3/atual.png" onChange={onChange} upload={upload} />);
    await user.upload(input(), png());
    await waitFor(() => expect(last()?.change.kind).toBe('replace'));
    await user.click(screen.getByRole('button', { name: 'Descartar nova imagem' }));
    expect(last()).toEqual({ change: { kind: 'keep' }, uploading: false });
    expect(screen.getByAltText('Imagem atual do produto')).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('escolher um segundo arquivo durante o envio do primeiro: a barra fica e o salvar segue bloqueado', async () => {
    const upload = vi.fn(
      (_f: File, _p: (n: number) => void, options?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('x', 'AbortError')),
          );
        }),
    );
    render(<ImageUpload currentUrl={null} onChange={onChange} upload={upload} />);
    await user.upload(input(), png(1000, 'primeira.png'));
    await screen.findByRole('progressbar');
    await user.upload(input(), png(1000, 'segunda.png'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    // o catch do primeiro (abortado) já rodou: nada do estado pode ter sido tocado
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(last()?.uploading).toBe(true);
    expect(states.filter((s) => !s.uploading)).toEqual([]);
  });

  it('remover -> enviar outra -> descartar volta a REMOVER (não a manter a imagem antiga)', async () => {
    const upload = vi.fn().mockResolvedValue(KEY);
    render(<ImageUpload currentUrl="http://s3/atual.png" onChange={onChange} upload={upload} />);
    await user.click(screen.getByRole('button', { name: 'Remover imagem' }));
    await user.upload(input(), png());
    await waitFor(() => expect(last()?.change).toEqual({ kind: 'replace', key: KEY }));
    await user.click(screen.getByRole('button', { name: 'Descartar nova imagem' }));
    expect(last()).toEqual({ change: { kind: 'remove' }, uploading: false });
    expect(screen.getByText('A imagem será removida quando você salvar.')).toBeTruthy();
    expect(screen.queryByAltText('Imagem atual do produto')).toBeNull();
  });

  it('"Cancelar envio" aborta o upload em andamento', async () => {
    let signal: AbortSignal | undefined;
    const upload = vi.fn(
      (_f: File, _p: (n: number) => void, options?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    render(<ImageUpload currentUrl={null} onChange={onChange} upload={upload} />);
    await user.upload(input(), png());
    await user.click(await screen.findByRole('button', { name: 'Cancelar envio' }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(last()).toEqual({ change: { kind: 'keep' }, uploading: false }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
