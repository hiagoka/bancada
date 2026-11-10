// Servidor HTTP FALSO da AbacatePay. SÓ PARA DESENVOLVIMENTO E TESTES: não entra no build de
// produção (o tsconfig.build só compila src/) nem na imagem Docker (só dist/ é copiado).
//
// Dois usos, o MESMO código:
// 1) testes da API (test/fake-abacatepay.ts): servidor em porta aleatória, sem nada de rede real;
// 2) execução à mão (scripts/fake-abacatepay-server.ts, `npm run dev:fake-abacatepay`): serve para
//    testar o fluxo de pagamento por Pix no navegador sem chave real da AbacatePay.
//
// Imita (formato da documentação oficial):
//   POST /v2/transparents/create   cria a cobrança Pix (pix_char_..., brCode, QR Code PNG, expiresAt)
//   GET  /v2/transparents/check    status da cobrança (?id=)
// E tem um endpoint que NÃO existe na AbacatePay, só para desenvolvimento:
//   POST /__pay/:id                marca a cobrança como PAID e ENTREGA o webhook transparent.completed
//                                  na API (secret no header e assinatura HMAC sobre o corpo cru, com o
//                                  MESMO módulo de assinatura da API).
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import { abacatePaySignature } from '../src/modules/payments/abacatepay.signature.js';

export const DEFAULT_FAKE_WEBHOOK_URL = 'http://127.0.0.1:3333/webhooks/abacatepay';
const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  rawBody: string;
  json: unknown;
}

// Troca a resposta de uma requisição (testes de falha). 'default' cai no comportamento normal.
export type Responder = (
  req: RecordedRequest,
  res: ServerResponse,
) => void | 'default' | Promise<void | 'default'>;

export interface Charge {
  id: string;
  amount: number;
  status: string;
  brCode: string;
  qrImage: string;
  externalId: string | null;
  metadata: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface FakeAbacatePayOptions {
  // 0 = porta aleatória (testes).
  port?: number;
  host?: string;
  // Para onde o /__pay entrega o webhook, e o segredo do header X-Webhook-Secret (o mesmo
  // ABACATEPAY_WEBHOOK_SECRET da API).
  webhookUrl?: string;
  webhookSecret?: string;
  // true (execução à mão): id desconhecido no /check é 404 e a cobrança vencida vira EXPIRED, como
  // na AbacatePay. false (padrão, testes): id desconhecido é PENDING.
  strict?: boolean;
  // Geradores (os testes fixam valores).
  chargeId?: (sequence: number) => string;
  brCode?: (chargeId: string, amountCents: number) => string;
  qrImage?: (brCode: string) => string;
}

export interface FakeAbacatePayServer {
  // Base da API, como ABACATEPAY_API_URL (termina em /v2).
  url: string;
  // Servidor sem o /v2 (onde fica o /__pay).
  origin: string;
  requests: RecordedRequest[];
  charges: Map<string, Charge>;
  // Status que o /check devolve para um id, por cima do status real da cobrança.
  checkStatuses: Map<string, string>;
  responder: Responder | null;
  setWebhookUrl: (url: string) => void;
  close: () => Promise<void>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// --- QR Code de desenvolvimento ----------------------------------------------------------------
// ATENÇÃO: NÃO é um QR Code Pix de verdade (não há gerador de QR no projeto e nada escaneia isto).
// É um PNG VÁLIDO, determinístico a partir do brCode, com o desenho de um QR Code (três
// localizadores, linhas de sincronismo e módulos derivados do SHA-256): serve para ver a tela como
// ela ficará e para exercitar o <img>. Para pagar, use o copia e cola ou o botão de pagar do script.
const MODULES = 29;
const QUIET = 4;
const PIXELS_PER_MODULE = 6;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function isDark(x: number, y: number, bits: Buffer): boolean {
  const finder = (ox: number, oy: number): boolean | null => {
    const dx = x - ox;
    const dy = y - oy;
    if (dx < -1 || dy < -1 || dx > 7 || dy > 7) return null;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false; // separador claro
    const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
    const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    return edge || core;
  };
  const corners = [finder(0, 0), finder(MODULES - 7, 0), finder(0, MODULES - 7)];
  for (const corner of corners) if (corner !== null) return corner;
  if (y === 6) return x % 2 === 0; // sincronismo horizontal
  if (x === 6) return y % 2 === 0; // sincronismo vertical
  const index = y * MODULES + x;
  return ((bits[index >> 3]! >> (index & 7)) & 1) === 1;
}

export function renderPlaceholderQrPng(seed: string): Buffer {
  // Fluxo de bits determinístico: SHA-256 encadeado até cobrir todos os módulos.
  const needed = Math.ceil((MODULES * MODULES) / 8);
  const chunks: Buffer[] = [];
  let digest = createHash('sha256').update(seed).digest();
  while (chunks.length * 32 < needed) {
    chunks.push(digest);
    digest = createHash('sha256').update(digest).digest();
  }
  const bits = Buffer.concat(chunks);

  const side = (MODULES + QUIET * 2) * PIXELS_PER_MODULE;
  const rows: Buffer[] = [];
  for (let py = 0; py < side; py += 1) {
    const row = Buffer.alloc(side + 1); // [0] = filtro "nenhum"
    const my = Math.floor(py / PIXELS_PER_MODULE) - QUIET;
    for (let px = 0; px < side; px += 1) {
      const mx = Math.floor(px / PIXELS_PER_MODULE) - QUIET;
      const inside = mx >= 0 && my >= 0 && mx < MODULES && my < MODULES;
      row[px + 1] = inside && isDark(mx, my, bits) ? 0 : 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // 8 bits por pixel
  ihdr[9] = 0; // escala de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const placeholderQrImage = (brCode: string): string =>
  `data:image/png;base64,${renderPlaceholderQrPng(brCode).toString('base64')}`;

// "Copia e cola" com cara de Pix (NÃO é válido: o CRC final é fictício).
export const placeholderBrCode = (chargeId: string, amountCents: number): string => {
  const amount = (amountCents / 100).toFixed(2);
  return (
    `00020101021226950014br.gov.bcb.pix0136${randomUUID()}` +
    `5204000053039865406${amount}5802BR5910BANCADA DEV6009SAO PAULO` +
    `62${String(chargeId.length + 4).padStart(2, '0')}05${String(chargeId.length).padStart(2, '0')}${chargeId}6304DEV0`
  );
};

// --- Servidor ----------------------------------------------------------------------------------

function webhookBody(charge: Charge): string {
  return JSON.stringify({
    id: `log_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: true,
    data: {
      transparent: {
        id: charge.id,
        externalId: charge.externalId,
        amount: charge.amount,
        customerFee: null,
        paidAmount: null,
        platformFee: 80,
        status: 'PAID',
        items: [],
        methods: [],
        frequency: 'ONE_TIME',
        coupons: [],
        devMode: true,
        createdAt: charge.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
        receiptUrl: null,
        metadata: charge.metadata,
      },
      // Dados mascarados, como a AbacatePay manda. A API nunca os lê nem os registra em log.
      customer: {
        id: 'cust_dev',
        name: 'Pagador de Teste',
        email: 'teste@example.com',
        taxId: '529.***.247-**',
      },
      payerInformation: {
        method: 'PIX',
        PIX: { name: 'Pagador de Teste', taxId: '529.***.247-**' },
      },
    },
  });
}

export async function startFakeAbacatePay(
  options: FakeAbacatePayOptions = {},
): Promise<FakeAbacatePayServer> {
  const strict = options.strict ?? false;
  const chargeId = options.chargeId ?? ((n: number) => `pix_char_${Date.now().toString(36)}${n}`); // único entre execuções (índice único no banco)
  const makeBrCode = options.brCode ?? placeholderBrCode;
  const makeQr = options.qrImage ?? placeholderQrImage;
  let webhookUrl = options.webhookUrl ?? DEFAULT_FAKE_WEBHOOK_URL;
  let sequence = 0;

  const state: FakeAbacatePayServer = {
    url: '',
    origin: '',
    requests: [],
    charges: new Map(),
    checkStatuses: new Map(),
    responder: null,
    setWebhookUrl: (url) => {
      webhookUrl = url;
    },
    close: async () => undefined,
  };

  const statusOf = (charge: Charge): string => {
    const forced = state.checkStatuses.get(charge.id);
    if (forced !== undefined) return forced;
    if (strict && charge.status === 'PENDING' && Date.now() > charge.expiresAt.getTime()) {
      return 'EXPIRED';
    }
    return charge.status;
  };

  function create(req: RecordedRequest, res: ServerResponse): void {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      sendJson(res, 401, { error: 'Token de autenticação inválido ou ausente.' });
      return;
    }
    const data = (req.json as { data?: Record<string, unknown> } | null)?.data;
    if (!data || typeof data !== 'object') {
      sendJson(res, 400, { success: false, error: 'data is required' });
      return;
    }
    const { amount, expiresIn } = data;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 100) {
      sendJson(res, 400, { success: false, error: 'amount must be an integer of at least 100' });
      return;
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn < 300) {
      sendJson(res, 400, { success: false, error: 'expiresIn must be at least 300 seconds' });
      return;
    }
    sequence += 1;
    const id = chargeId(sequence);
    const now = new Date();
    const brCode = makeBrCode(id, amount);
    const charge: Charge = {
      id,
      amount,
      status: 'PENDING',
      brCode,
      qrImage: makeQr(brCode),
      externalId: typeof data.externalId === 'string' ? data.externalId : null,
      metadata: data.metadata ?? {},
      createdAt: now,
      expiresAt: new Date(now.getTime() + expiresIn * 1000),
    };
    state.charges.set(id, charge);
    sendJson(res, 200, {
      data: {
        id,
        amount,
        status: 'PENDING',
        devMode: true,
        brCode,
        brCodeBase64: charge.qrImage,
        platformFee: 80,
        receiptUrl: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: charge.expiresAt.toISOString(),
        metadata: charge.metadata,
      },
      success: true,
      error: null,
    });
  }

  function check(req: RecordedRequest, res: ServerResponse): void {
    const id = req.query.get('id') ?? '';
    const charge = state.charges.get(id);
    if (!charge && strict) {
      sendJson(res, 404, { success: false, error: 'Pix QR Code not found' });
      return;
    }
    sendJson(res, 200, {
      data: {
        id,
        status: charge ? statusOf(charge) : (state.checkStatuses.get(id) ?? 'PENDING'),
        expiresAt: (charge?.expiresAt ?? new Date(Date.now() + 60_000)).toISOString(),
      },
      error: null,
      success: true,
    });
  }

  async function pay(id: string, res: ServerResponse): Promise<void> {
    const charge = state.charges.get(id);
    if (!charge) {
      sendJson(res, 404, { error: 'Pix QR Code not found' });
      return;
    }
    if (charge.status !== 'PENDING') {
      sendJson(res, 409, { error: `A cobrança já está ${charge.status}` });
      return;
    }
    if (!options.webhookSecret) {
      sendJson(res, 500, {
        error:
          'ABACATEPAY_WEBHOOK_SECRET não está definido: sem ele não dá para entregar o webhook. ' +
          'Use o MESMO valor (32+ caracteres) da API.',
      });
      return;
    }
    charge.status = 'PAID';
    const body = webhookBody(charge);
    try {
      const delivered = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': options.webhookSecret,
          'X-Webhook-Signature': abacatePaySignature(body),
        },
        body,
        signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      });
      const text = await delivered.text();
      sendJson(res, 200, {
        paid: true,
        charge: id,
        webhook: { url: webhookUrl, status: delivered.status, body: text.slice(0, 500) },
      });
    } catch (err) {
      sendJson(res, 502, {
        paid: true,
        charge: id,
        error:
          `A cobrança ficou PAID, mas o webhook não chegou à API em ${webhookUrl}: ` +
          `${err instanceof Error ? err.message : 'falha desconhecida'}. A API está no ar?`,
      });
    }
  }

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
          create(recorded, res);
          return;
        }
        if (recorded.method === 'GET' && url.pathname === '/v2/transparents/check') {
          check(recorded, res);
          return;
        }
        const payMatch = /^\/__pay\/([^/]+)$/.exec(url.pathname);
        if (recorded.method === 'POST' && payMatch) {
          await pay(decodeURIComponent(payMatch[1]!), res);
          return;
        }
        sendJson(res, 404, { success: false, error: 'Rota inexistente no servidor falso' });
      })();
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve),
  );
  const { port } = server.address() as AddressInfo;
  const host = options.host ?? '127.0.0.1';
  state.origin = `http://${host}:${port}`;
  state.url = `${state.origin}/v2`; // mesma forma da API real: a base termina em /v2
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}
