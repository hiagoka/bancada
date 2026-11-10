import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Servidor HTTP FALSO que imita a API da AbacatePay (nada de rede real nos testes).
export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  rawBody: string;
  json: unknown;
}

export type Responder = (
  req: RecordedRequest,
  res: ServerResponse,
) => void | 'default' | Promise<void | 'default'>;

export interface FakeAbacatePay {
  url: string;
  requests: RecordedRequest[];
  // Status que o /transparents/check devolve para cada id (padrão PENDING).
  checkStatuses: Map<string, string>;
  // Substitui a resposta (por requisição). 'default' cai no comportamento normal.
  responder: Responder | null;
  close: () => Promise<void>;
}

export const FAKE_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
export const FAKE_BR_CODE = '00020101021226950014br.gov.bcb.pix0136pix-de-teste';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startFakeAbacatePay(): Promise<FakeAbacatePay> {
  const state: FakeAbacatePay = {
    url: '',
    requests: [],
    checkStatuses: new Map(),
    responder: null,
    close: async () => undefined,
  };
  let seq = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://fake');
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          json = null;
        }
        const recorded: RecordedRequest = {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          rawBody,
          json,
        };
        state.requests.push(recorded);

        if (state.responder) {
          const result = await state.responder(recorded, res);
          if (result !== 'default') return;
        }

        if (recorded.method === 'POST' && url.pathname === '/v2/transparents/create') {
          const data = (json as { data: { amount: number; expiresIn: number } }).data;
          seq += 1;
          sendJson(res, 200, {
            data: {
              id: `pix_char_fake${seq}`,
              amount: data.amount,
              status: 'PENDING',
              devMode: true,
              brCode: FAKE_BR_CODE,
              brCodeBase64: FAKE_QR_IMAGE,
              platformFee: 80,
              receiptUrl: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString(),
              metadata: {},
            },
            success: true,
            error: null,
          });
          return;
        }
        if (recorded.method === 'GET' && url.pathname === '/v2/transparents/check') {
          const id = url.searchParams.get('id') ?? '';
          sendJson(res, 200, {
            data: {
              id,
              status: state.checkStatuses.get(id) ?? 'PENDING',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
            success: true,
          });
          return;
        }
        sendJson(res, 404, { success: false, error: 'Rota inexistente no servidor falso' });
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  // Mesma forma da API real: a base termina em /v2.
  state.url = `http://127.0.0.1:${port}/v2`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}
