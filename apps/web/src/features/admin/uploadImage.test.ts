import { MAX_UPLOAD_BYTES } from '@bancada/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UploadError,
  uploadFileToStorage,
  uploadProductImage,
  validateImageFile,
  type XhrLike,
} from './uploadImage';

const file = (type: string, size: number, name = 'foto.png'): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateImageFile', () => {
  it.each([['image/jpeg'], ['image/png'], ['image/webp']])('aceita %s', (type) => {
    expect(validateImageFile(file(type, 1000))).toBeNull();
  });

  it('aceita exatamente 2 MB', () => {
    expect(validateImageFile(file('image/png', MAX_UPLOAD_BYTES))).toBeNull();
  });

  it('recusa 2 MB + 1 byte', () => {
    expect(validateImageFile(file('image/png', MAX_UPLOAD_BYTES + 1))).toBe(
      'A imagem deve ter no máximo 2 MB.',
    );
  });

  it.each([['image/gif'], ['image/svg+xml'], ['application/pdf'], ['text/html'], ['']])(
    'recusa o tipo %j',
    (type) => {
      expect(validateImageFile(file(type, 1000))).toBe(
        'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP.',
      );
    },
  );

  it('recusa arquivo vazio', () => {
    expect(validateImageFile(file('image/png', 0))).toBe('O arquivo está vazio.');
  });
});

// XMLHttpRequest de mentira: grava o que foi enviado e deixa o teste disparar os eventos.
class FakeXhr implements XhrLike {
  static last: FakeXhr;
  method = '';
  url = '';
  body: FormData | null = null;
  status = 0;
  aborted = false;
  withCredentials = false;
  upload: {
    onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}
const factory = () => new FakeXhr();

describe('uploadFileToStorage', () => {
  const upload = {
    uploadUrl: 'http://localhost:9000/bancada',
    fields: { key: 'products/x.png', 'Content-Type': 'image/png', Policy: 'p' },
    key: 'products/x.png',
  };

  it('POST multipart: os fields ANTES do arquivo, o arquivo por último com o nome "file"', async () => {
    const f = file('image/png', 10);
    const done = uploadFileToStorage(upload, f, () => undefined, { createXhr: factory });
    const xhr = FakeXhr.last;
    xhr.status = 204;
    xhr.onload?.();
    await expect(done).resolves.toBeUndefined();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://localhost:9000/bancada');
    expect(xhr.withCredentials).toBe(false); // nada de cookie do admin para o S3
    const entries = [...(xhr.body?.entries() ?? [])].map(([k]) => k);
    expect(entries).toEqual(['key', 'Content-Type', 'Policy', 'file']);
    expect(xhr.body?.get('key')).toBe('products/x.png');
  });

  it('reporta o progresso em porcentagem inteira', async () => {
    const onProgress = vi.fn();
    const done = uploadFileToStorage(upload, file('image/png', 10), onProgress, {
      createXhr: factory,
    });
    const xhr = FakeXhr.last;
    xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 5, total: 0, lengthComputable: false });
    xhr.status = 204;
    xhr.onload?.();
    await done;
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([25, 100]);
  });

  it.each([[403], [400], [500]])('status %s vira UploadError', async (status) => {
    const done = uploadFileToStorage(upload, file('image/png', 10), () => undefined, {
      createXhr: factory,
    });
    FakeXhr.last.status = status;
    FakeXhr.last.onload?.();
    await expect(done).rejects.toBeInstanceOf(UploadError);
  });

  it('falha de rede vira UploadError', async () => {
    const done = uploadFileToStorage(upload, file('image/png', 10), () => undefined, {
      createXhr: factory,
    });
    FakeXhr.last.onerror?.();
    await expect(done).rejects.toBeInstanceOf(UploadError);
  });

  it('cancelar (AbortSignal) aborta o envio', async () => {
    const controller = new AbortController();
    const done = uploadFileToStorage(upload, file('image/png', 10), () => undefined, {
      createXhr: factory,
      signal: controller.signal,
    });
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.aborted).toBe(true);
  });
});

describe('uploadProductImage: cancelamento', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cancelar durante o presign aborta o fetch à API (o signal chega até lá)', async () => {
    let seen: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const done = uploadProductImage(file('image/png', 10), () => undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.aborted).toBe(false);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });
});
