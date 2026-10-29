import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  type UploadResponse,
} from '@bancada/contracts';
import { requestProductImageUpload } from '../../api/adminProducts';

export const INVALID_TYPE_MESSAGE = 'Tipo de arquivo não permitido. Use JPEG, PNG ou WebP.';
export const TOO_BIG_MESSAGE = 'A imagem deve ter no máximo 2 MB.';
export const EMPTY_FILE_MESSAGE = 'O arquivo está vazio.';

// Conferência no cliente (o S3 impõe tipo declarado e tamanho de qualquer jeito): devolve a
// mensagem de erro em PT-BR, ou null se o arquivo serve.
export function validateImageFile(file: File): string | null {
  if (!(ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return INVALID_TYPE_MESSAGE;
  }
  if (file.size === 0) return EMPTY_FILE_MESSAGE;
  if (file.size > MAX_UPLOAD_BYTES) return TOO_BIG_MESSAGE;
  return null;
}

// O envio ao S3/MinIO falhou (recusado ou rede).
export class UploadError extends Error {
  constructor(message = 'Não foi possível enviar a imagem. Tente de novo.') {
    super(message);
    this.name = 'UploadError';
  }
}

// O pedaço de XMLHttpRequest que usamos (fetch não informa o progresso do envio).
export interface XhrLike {
  withCredentials: boolean;
  upload: { onprogress: ((event: ProgressEvent) => unknown) | null };
  onload: ((event: ProgressEvent) => unknown) | null;
  onerror: ((event: ProgressEvent) => unknown) | null;
  onabort: ((event: ProgressEvent) => unknown) | null;
  status: number;
  open(method: string, url: string): void;
  send(body: FormData): void;
  abort(): void;
}

interface UploadOptions {
  signal?: AbortSignal;
  createXhr?: () => XhrLike;
}

// Envia o arquivo direto ao S3/MinIO com o presigned POST: os fields da API vão ANTES do arquivo
// (exigência do S3) e o arquivo por último. Sem cookies: o bucket é de outra origem.
export function uploadFileToStorage(
  upload: UploadResponse,
  file: File,
  onProgress: (percent: number) => void,
  { signal, createXhr = () => new XMLHttpRequest() }: UploadOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Envio cancelado', 'AbortError'));
      return;
    }
    const xhr = createXhr();
    xhr.withCredentials = false;
    xhr.open('POST', upload.uploadUrl);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError());
    };
    xhr.onerror = () => reject(new UploadError());
    xhr.onabort = () => reject(new DOMException('Envio cancelado', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append('file', file);
    xhr.send(form);
  });
}

// Fluxo completo: valida, pede o presigned POST à API, envia ao S3 e devolve a imageKey.
export async function uploadProductImage(
  file: File,
  onProgress: (percent: number) => void,
  options: UploadOptions = {},
): Promise<string> {
  const problem = validateImageFile(file);
  if (problem) throw new UploadError(problem);
  const upload = await requestProductImageUpload(file.type, options.signal);
  await uploadFileToStorage(upload, file, onProgress, options);
  return upload.key;
}
