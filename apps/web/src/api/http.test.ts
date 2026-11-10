import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetServerClock, serverNow } from '../lib/serverClock';
import { ApiError, NetworkError, createHttpClient, resolveApiUrl } from './http';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    typeof response === 'function' ? response() : response,
  );
  const client = createHttpClient({ baseUrl: 'http://api.test', fetch: fetchMock });
  const lastCall = () => {
    const [url, init = {}] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
    return { url, init, headers: new Headers(init.headers) };
  };
  return { client, fetchMock, lastCall };
}

describe('request: o que é enviado', () => {
  it('GET: credentials include, X-Requested-With, Accept e sem corpo nem Content-Type', async () => {
    const { client, lastCall } = setup(json({ data: [] }));
    await client.request('/products');
    const { url, init, headers } = lastCall();
    expect(url).toBe('http://api.test/products');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('POST com corpo: JSON, Content-Type e os mesmos headers de segurança', async () => {
    const { client, lastCall } = setup(json({ data: { ok: true } }, 201));
    await client.request('/orders', { method: 'POST', body: { a: 1 } });
    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"a":1}');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)(
    '%s sem dados envia {} (exigência do CSRF, D15) com Content-Type JSON',
    async (method) => {
      const { client, lastCall } = setup(json({ data: null }));
      await client.request('/auth/logout', { method });
      const { init, headers } = lastCall();
      expect(init.body).toBe('{}');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-Requested-With')).toBe('bancada-web');
    },
  );

  it('aceita headers extras (Idempotency-Key) sem poder sobrescrever os de segurança', async () => {
    const { client, lastCall } = setup(json({ data: 1 }));
    await client.request('/orders', {
      method: 'POST',
      body: {},
      headers: {
        'Idempotency-Key': 'chave-1',
        'X-Requested-With': 'malicioso',
        'Content-Type': 'text/plain',
      },
    });
    const { headers } = lastCall();
    expect(headers.get('Idempotency-Key')).toBe('chave-1');
    expect(headers.get('X-Requested-With')).toBe('bancada-web');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('o cancelamento do chamador chega ao fetch (junto com o timeout)', async () => {
    const { client, lastCall } = setup(json({ data: 1 }));
    const controller = new AbortController();
    await client.request('/products', { signal: controller.signal });
    const sent = lastCall().init.signal as AbortSignal;
    expect(sent.aborted).toBe(false);
    controller.abort();
    expect(sent.aborted).toBe(true);
  });

  it('junta base e caminho sem barra duplicada', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: 1 }));
    const client = createHttpClient({ baseUrl: 'http://api.test/', fetch: fetchMock });
    await client.request('/products');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/products');
  });
});

describe('request: respostas de sucesso', () => {
  it('desembrulha o envelope {data}', async () => {
    const { client } = setup(json({ data: [{ id: '1' }] }));
    await expect(client.request('/products')).resolves.toEqual([{ id: '1' }]);
  });

  it('204 sem corpo devolve undefined', async () => {
    const { client } = setup(new Response(null, { status: 204 }));
    await expect(client.request('/x', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('valida com o schema Zod quando informado e devolve o dado tipado', async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    const { client } = setup(json({ data: { id: 'a', n: 3, extra: true } }));
    await expect(client.request('/x', { schema })).resolves.toEqual({ id: 'a', n: 3 });
  });

  it('resposta fora do schema vira ApiError INTERNAL_ERROR', async () => {
    const schema = z.object({ id: z.string() });
    const { client } = setup(json({ data: { id: 5 } }));
    await expect(client.request('/x', { schema })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL_ERROR',
      status: 200,
    });
  });
});

describe('relógio do servidor (header Date)', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetServerClock();
  });

  const withDate = (date: string, status = 200) =>
    new Response(
      JSON.stringify(
        status === 200 ? { data: {} } : { error: { code: 'NOT_FOUND', message: 'x' } },
      ),
      {
        status,
        headers: { 'Content-Type': 'application/json', Date: date },
      },
    );

  it('a resposta com Date acerta serverNow() (relógio local 10 min atrasado)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const { client } = setup(withDate('Tue, 10 Nov 2026 12:10:00 GMT'));
    await client.request('/x');
    expect(Math.abs(serverNow() - Date.parse('2026-11-10T12:10:00.500Z'))).toBeLessThan(100);
  });

  it('respostas de ERRO também reajustam o relógio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const { client } = setup(withDate('Tue, 10 Nov 2026 12:05:00 GMT', 404));
    await client.request('/x').catch(() => undefined);
    expect(Math.abs(serverNow() - Date.parse('2026-11-10T12:05:00.500Z'))).toBeLessThan(100);
  });

  it('resposta com Age > 5 s (cache compartilhado) NÃO acerta o relógio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    const cached = new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        Date: 'Tue, 10 Nov 2026 11:00:00 GMT',
        Age: '120',
      },
    });
    const { client } = setup(cached);
    await client.request('/x');
    expect(serverNow()).toBe(Date.now()); // sem correção
  });

  it('sem header Date legível o relógio local continua valendo', async () => {
    const { client } = setup(json({ data: {} }));
    await client.request('/x');
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });
});

describe('request: erros', () => {
  it('4xx com envelope vira ApiError com status, code, message e details', async () => {
    const details = [{ productId: 'p', requested: 3, available: 1 }];
    const { client } = setup(
      json({ error: { code: 'OUT_OF_STOCK', message: 'Estoque insuficiente', details } }, 409),
    );
    const error = await client.request('/orders', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'OUT_OF_STOCK',
      message: 'Estoque insuficiente',
      details,
    });
  });

  it('5xx com envelope vira ApiError; sem details fica undefined', async () => {
    const { client } = setup(
      json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } }, 500),
    );
    const error = (await client.request('/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.details).toBeUndefined();
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'CSRF_REJECTED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [502, 'CHECKOUT_UNAVAILABLE'],
  ] as const)('%d %s', async (status, code) => {
    const { client } = setup(json({ error: { code, message: 'm' } }, status));
    await expect(client.request('/x')).rejects.toMatchObject({ status, code });
  });

  it('erro de rede (fetch rejeitando) vira NetworkError', async () => {
    const { client } = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await client.request('/products').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as NetworkError).message).toMatch(/API/);
  });

  it('AbortError NÃO vira NetworkError (cancelamento é repassado)', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const { client } = setup(async () => {
      throw abort;
    });
    await expect(client.request('/x')).rejects.toBe(abort);
  });

  it('corpo que não é JSON (sucesso): ApiError INTERNAL_ERROR', async () => {
    const { client } = setup(new Response('<html>oops</html>', { status: 200 }));
    await expect(client.request('/x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL_ERROR',
      status: 200,
    });
  });

  it('corpo que não é JSON (erro 502 de proxy): ApiError INTERNAL_ERROR com o status real', async () => {
    const { client } = setup(new Response('Bad Gateway', { status: 502 }));
    await expect(client.request('/x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('sucesso sem a chave data: ApiError INTERNAL_ERROR', async () => {
    const { client } = setup(json({ resultado: 1 }));
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('erro com envelope inválido ou code fora da lista fechada: INTERNAL_ERROR com o status real', async () => {
    for (const body of [{ error: { code: 'CODIGO_NOVO', message: 'm' } }, { error: 'texto' }, {}]) {
      const { client } = setup(json(body, 418));
      await expect(client.request('/x')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 418,
      });
    }
  });

  it('204 mas com schema: devolve undefined sem validar', async () => {
    const { client } = setup(new Response(null, { status: 204 }));
    await expect(
      client.request('/x', { method: 'DELETE', schema: z.string() }),
    ).resolves.toBeUndefined();
  });
});

describe('timeout e cancelamento', () => {
  // fetch que nunca responde, mas obedece ao AbortSignal (como o fetch de verdade).
  const hanging = (): typeof fetch =>
    ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;

  it('API travada: estoura o timeout e vira NetworkError (não fica carregando para sempre)', async () => {
    const client = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: hanging(),
      timeoutMs: 20,
    });
    const error = await client.request('/products').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
  });

  it('cancelamento pelo chamador continua sendo AbortError, não NetworkError', async () => {
    const client = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: hanging(),
      timeoutMs: 5_000,
    });
    const controller = new AbortController();
    const pending = client
      .request('/products', { signal: controller.signal })
      .catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('o timeout também vale para a leitura do corpo da resposta', async () => {
    const slowBody = (_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      } as Response);
    const client = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: slowBody as typeof fetch,
      timeoutMs: 20,
    });
    await expect(client.request('/x')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('resolveApiUrl', () => {
  it('usa VITE_API_URL quando definida', () => {
    expect(resolveApiUrl({ VITE_API_URL: 'https://api.bancada.dev', PROD: true })).toBe(
      'https://api.bancada.dev',
    );
  });

  it('em desenvolvimento, cai no localhost:3333', () => {
    expect(resolveApiUrl({ PROD: false })).toBe('http://localhost:3333');
  });

  it('em produção sem VITE_API_URL, falha com mensagem clara em vez de apontar para o localhost', () => {
    expect(() => resolveApiUrl({ PROD: true })).toThrow(/VITE_API_URL/);
    expect(() => resolveApiUrl({ VITE_API_URL: '', PROD: true })).toThrow(/VITE_API_URL/);
  });
});
