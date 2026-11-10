import { apiErrorSchema, type ErrorCode } from '@bancada/contracts';
import type { ZodType } from 'zod';
import { recordServerDate } from '../lib/serverClock';

// Erro devolvido pela API no envelope { error: { code, message, details? } }.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// A API não respondeu (fora do ar, sem rede, CORS bloqueado).
export class NetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      'Não foi possível falar com a API. Verifique se ela está no ar e tente de novo.',
      options,
    );
    this.name = 'NetworkError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<T> {
  method?: HttpMethod;
  body?: unknown;
  // Valida (e tipa) o conteúdo de `data` com um schema do contracts.
  schema?: ZodType<T>;
  signal?: AbortSignal;
  // Headers extras (ex.: Idempotency-Key). Não sobrescrevem os de segurança.
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  // Tempo máximo de uma requisição (conexão + corpo). Padrão 15 s.
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

// Cancelamento do chamador (AbortError) passa como está; timeout e falha de rede viram NetworkError.
function toRequestError(err: unknown): unknown {
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  return new NetworkError({ cause: err });
}

const SERVER_ERROR_MESSAGE = 'Resposta inesperada do servidor.';

export function createHttpClient({
  baseUrl,
  fetch: fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: HttpClientOptions) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const hasBody = method !== 'GET';

    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    // CSRF (D15): em TODAS as requisições. Em mutações, também Content-Type JSON e corpo
    // ('{}' quando não há dados).
    headers.set('X-Requested-With', 'bancada-web');
    if (hasBody) headers.set('Content-Type', 'application/json');
    else headers.delete('Content-Type');

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    let text: string;
    let rttMs: number;
    try {
      const sentAt = performance.now();
      response = await (fetchImpl ?? fetch)(`${base}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: hasBody ? JSON.stringify(options.body ?? {}) : undefined,
        signal,
      });
      rttMs = performance.now() - sentAt; // até receber os headers
      text = await response.text();
    } catch (err) {
      throw toRequestError(err);
    }
    // Relógio do servidor (contagem do Pix): ignora resposta de cache (Age) e prefere o menor RTT.
    recordServerDate(response.headers.get('Date'), { age: response.headers.get('Age'), rttMs });
    if (response.ok && text === '') return undefined as T; // 204

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'INTERNAL_ERROR', SERVER_ERROR_MESSAGE);
    }

    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(payload);
      if (!envelope.success) {
        throw new ApiError(response.status, 'INTERNAL_ERROR', SERVER_ERROR_MESSAGE);
      }
      const { code, message, details } = envelope.data.error;
      throw new ApiError(response.status, code, message, details);
    }

    if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
      throw new ApiError(response.status, 'INTERNAL_ERROR', SERVER_ERROR_MESSAGE);
    }
    const data = payload.data;
    if (!options.schema) return data as T;

    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        'INTERNAL_ERROR',
        SERVER_ERROR_MESSAGE,
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  return { request };
}

// Em produção a URL da API TEM de vir do build (VITE_API_URL): não existe "padrão" seguro.
export function resolveApiUrl(env: { VITE_API_URL?: string; PROD?: boolean }): string {
  if (env.VITE_API_URL) return env.VITE_API_URL;
  if (env.PROD) {
    throw new Error('VITE_API_URL não foi definida neste build: defina-a antes de gerar o bundle.');
  }
  return 'http://localhost:3333';
}

let defaultClient: ReturnType<typeof createHttpClient> | undefined;

// Cliente padrão (criado na primeira chamada, para o erro de configuração aparecer com clareza).
export function request<T = unknown>(path: string, options?: RequestOptions<T>): Promise<T> {
  defaultClient ??= createHttpClient({ baseUrl: resolveApiUrl(import.meta.env) });
  return defaultClient.request(path, options);
}
