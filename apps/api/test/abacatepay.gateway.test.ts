import { GatewayError } from '../src/modules/payments/payment-gateway.js';
import {
  AbacatePayGateway,
  CheckoutExpiredError,
  mapAbacatePayStatus,
} from '../src/modules/payments/abacatepay.gateway.js';
import {
  FAKE_BR_CODE,
  FAKE_QR_IMAGE,
  sendJson,
  startFakeAbacatePay,
  type FakeAbacatePay,
} from './fake-abacatepay.js';

const API_KEY = 'abc_dev_chave-de-teste-que-nunca-pode-vazar';
const ORDER_ID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';
const NOW = new Date('2026-11-10T15:00:00.000Z');

let fake: FakeAbacatePay;

beforeEach(async () => {
  fake = await startFakeAbacatePay();
});
afterEach(async () => {
  await fake.close();
});

function gateway(options: { timeoutMs?: number; apiUrl?: string } = {}): AbacatePayGateway {
  return new AbacatePayGateway({
    apiKey: API_KEY,
    apiUrl: options.apiUrl ?? fake.url,
    timeoutMs: options.timeoutMs,
    now: () => NOW,
  });
}

function checkoutRequest(overrides: { expiresAt?: Date; totalCents?: number } = {}) {
  return {
    orderId: ORDER_ID,
    items: [{ name: 'Mouse', unitPriceCents: 24900, quantity: 2 }],
    totalCents: overrides.totalCents ?? 49800,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 30 * 60 * 1000),
  };
}

describe('AbacatePayGateway.createCheckout', () => {
  it('POST /transparents/create com Bearer, JSON e o corpo da seção 8.9', async () => {
    const result = await gateway().createCheckout(checkoutRequest());
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v2/transparents/create');
    expect(req.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(req.headers['content-type']).toContain('application/json');
    expect(req.json).toEqual({
      method: 'PIX',
      data: {
        amount: 49800,
        expiresIn: 1800,
        externalId: ORDER_ID,
        description: 'Pedido 3F2504E0',
        metadata: { orderId: ORDER_ID },
      },
    });
    expect(result.checkoutId).toMatch(/^pix_char_/);
    expect(result.checkoutUrl).toBeNull();
    expect(result.pix).toEqual({
      brCode: FAKE_BR_CODE,
      qrCodeImage: FAKE_QR_IMAGE,
      expiresAt: expect.any(Date),
    });
  });

  it('não envia nenhum dado do cliente (nem customer, nem CPF, nem e-mail)', async () => {
    await gateway().createCheckout(checkoutRequest());
    const body = fake.requests[0]!.rawBody;
    expect(body).not.toContain('customer');
    expect(body).not.toContain('taxId');
    expect(body).not.toContain('email');
    expect(body).not.toContain('cellphone');
  });

  it('o valor é o total em centavos do pedido (nunca float) e vai como inteiro', async () => {
    await gateway().createCheckout(checkoutRequest({ totalCents: 54700 }));
    const data = (fake.requests[0]!.json as { data: { amount: unknown } }).data;
    expect(data.amount).toBe(54700);
    expect(Number.isInteger(data.amount)).toBe(true);
  });

  it.each([
    [30 * 60 * 1000, 1800],
    [10 * 60 * 1000, 600],
    [300 * 1000, 300],
    [300 * 1000 + 999, 300],
    [301 * 1000, 301],
  ])(
    'expiresIn = segundos inteiros até created_at + 30 min (%i ms -> %i s)',
    async (ms, seconds) => {
      await gateway().createCheckout(checkoutRequest({ expiresAt: new Date(NOW.getTime() + ms) }));
      const data = (fake.requests[0]!.json as { data: { expiresIn: number } }).data;
      expect(data.expiresIn).toBe(seconds);
    },
  );

  it.each([299 * 1000, 299_999, 60 * 1000, 1000, 0, -5000])(
    'faltando menos de 300 s (%i ms) NÃO chama a API e sinaliza expirado',
    async (ms) => {
      const attempt = gateway().createCheckout(
        checkoutRequest({ expiresAt: new Date(NOW.getTime() + ms) }),
      );
      await expect(attempt).rejects.toBeInstanceOf(CheckoutExpiredError);
      await expect(attempt).rejects.toBeInstanceOf(GatewayError);
      expect(fake.requests).toHaveLength(0);
    },
  );

  it('success:false vira GatewayError com a mensagem do provedor e sem a chave', async () => {
    fake.responder = (_req, res) => {
      sendJson(res, 200, { success: false, error: 'PIX is not available for this store' });
    };
    const error = await gateway()
      .createCheckout(checkoutRequest())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).notFound).toBe(false);
    expect((error as GatewayError).message).toContain('PIX is not available for this store');
    expect((error as GatewayError).message).not.toContain(API_KEY);
  });

  it.each([
    [400, { success: false, error: 'expiresIn must be at least 300 seconds' }],
    [401, { error: 'Token de autenticação inválido ou ausente.' }],
    [403, { success: false, error: 'sem permissão' }],
    [429, { success: false, error: 'devagar' }],
    [500, { success: false, error: 'boom' }],
    [502, 'bad gateway em texto puro'],
  ])('HTTP %i (não 2xx) vira GatewayError sem vazar a chave', async (status, body) => {
    fake.responder = (_req, res) => {
      if (typeof body === 'string') {
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(body);
      } else {
        sendJson(res, status, body);
      }
    };
    const error = await gateway()
      .createCheckout(checkoutRequest())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).message).toContain(String(status));
    expect((error as GatewayError).message).not.toContain(API_KEY);
    expect((error as GatewayError).notFound).toBe(false);
  });

  it('JSON inválido na resposta vira GatewayError', async () => {
    fake.responder = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{ isto não é json');
    };
    const error = await gateway()
      .createCheckout(checkoutRequest())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).message).toMatch(/inválida|JSON/i);
    expect((error as GatewayError).message).not.toContain(API_KEY);
  });

  it.each([
    ['sem data', { success: true }],
    [
      'sem id',
      { success: true, data: { brCode: 'x', brCodeBase64: 'y', expiresAt: NOW.toISOString() } },
    ],
    [
      'sem brCode',
      {
        success: true,
        data: { id: 'pix_char_1', brCodeBase64: 'y', expiresAt: NOW.toISOString() },
      },
    ],
    [
      'sem QR Code',
      { success: true, data: { id: 'pix_char_1', brCode: 'x', expiresAt: NOW.toISOString() } },
    ],
    [
      'expiresAt inválido',
      {
        success: true,
        data: { id: 'pix_char_1', brCode: 'x', brCodeBase64: 'y', expiresAt: 'amanhã' },
      },
    ],
  ])('resposta incompleta (%s) vira GatewayError', async (_nome, body) => {
    fake.responder = (_req, res) => sendJson(res, 200, body);
    await expect(gateway().createCheckout(checkoutRequest())).rejects.toBeInstanceOf(GatewayError);
  });

  it.each([
    'https://rastreador.example/qr.png',
    'http://localhost/qr.png',
    'data:text/html;base64,PGI+eDwvYj4=',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;charset=utf-8,abc',
    'javascript:alert(1)',
    'iVBORw0KGgo=',
  ])(
    'o QR Code que não é "data:image/png;base64,..." (%s) vira GatewayError (vai para um <img src>)',
    async (image) => {
      fake.responder = (_req, res) =>
        sendJson(res, 200, {
          success: true,
          data: {
            id: 'pix_char_1',
            brCode: FAKE_BR_CODE,
            brCodeBase64: image,
            expiresAt: new Date(NOW.getTime() + 1_800_000).toISOString(),
          },
        });
      const error = await gateway()
        .createCheckout(checkoutRequest())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).message).not.toContain(image);
    },
  );

  it('campos novos na resposta não quebram (sem schema rígido)', async () => {
    fake.responder = (_req, res) =>
      sendJson(res, 200, {
        success: true,
        error: null,
        data: {
          id: 'pix_char_novo',
          brCode: FAKE_BR_CODE,
          brCodeBase64: FAKE_QR_IMAGE,
          expiresAt: new Date(NOW.getTime() + 1_800_000).toISOString(),
          campoQueNaoExistiaAntes: { qualquer: 'coisa' },
        },
      });
    await expect(gateway().createCheckout(checkoutRequest())).resolves.toMatchObject({
      checkoutId: 'pix_char_novo',
    });
  });

  it('timeout curto: o servidor que não responde vira GatewayError', async () => {
    fake.responder = () => new Promise(() => undefined);
    const started = Date.now();
    const error = await gateway({ timeoutMs: 80 })
      .createCheckout(checkoutRequest())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect((error as GatewayError).message).not.toContain(API_KEY);
  });

  it('servidor fora do ar: GatewayError sem vazar a chave', async () => {
    await fake.close();
    const error = await gateway()
      .createCheckout(checkoutRequest())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).message).not.toContain(API_KEY);
    expect(String((error as GatewayError).stack)).not.toContain(API_KEY);
    fake = await startFakeAbacatePay(); // para o afterEach
  });

  it('a URL base aceita barra final', async () => {
    await gateway({ apiUrl: `${fake.url}/` }).createCheckout(checkoutRequest());
    expect(fake.requests[0]!.path).toBe('/v2/transparents/create');
  });
});

describe('AbacatePayGateway.getPayment', () => {
  it('GET /transparents/check?id= com Bearer e o id codificado', async () => {
    fake.checkStatuses.set('pix_char_abc', 'PAID');
    const payment = await gateway().getPayment('pix_char_abc');
    const req = fake.requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/v2/transparents/check');
    expect(req.query.get('id')).toBe('pix_char_abc');
    expect(req.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(payment).toEqual({
      id: 'pix_char_abc',
      status: 'approved',
      rawStatus: 'PAID',
      orderId: null,
      amountCents: null,
    });
  });

  it('um id com caracteres especiais não escapa da query', async () => {
    await gateway().getPayment('a&id=outro#x');
    expect(fake.requests[0]!.query.get('id')).toBe('a&id=outro#x');
    expect([...fake.requests[0]!.query.keys()]).toEqual(['id']);
  });

  it.each([
    ['PAID', 'approved'],
    ['REFUNDED', 'refunded'],
    ['UNDER_DISPUTE', 'in_mediation'],
    ['PENDING', 'pending'],
    ['APPROVED', 'unknown'],
    ['FAILED', 'unknown'],
    ['REDEEMED', 'unknown'],
    ['EXPIRED', 'unknown'],
    ['CANCELLED', 'unknown'],
    ['ALGO_NOVO', 'unknown'],
    ['', 'unknown'],
  ])('status %s -> %s (e o status bruto fica em rawStatus)', async (raw, mapped) => {
    expect(mapAbacatePayStatus(raw)).toBe(mapped);
    fake.checkStatuses.set('pix_char_s', raw);
    const payment = await gateway().getPayment('pix_char_s');
    expect(payment.status).toBe(mapped);
    expect(payment.rawStatus).toBe(raw);
  });

  it('HTTP 404 e "Pix QR Code not found" são notFound (o webhook responde 200)', async () => {
    fake.responder = (_req, res) => sendJson(res, 404, { success: false, error: 'not found' });
    const a = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect(a).toBeInstanceOf(GatewayError);
    expect((a as GatewayError).notFound).toBe(true);

    fake.responder = (_req, res) =>
      sendJson(res, 400, { success: false, error: 'Pix QR Code not found' });
    const b = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect((b as GatewayError).notFound).toBe(true);

    fake.responder = (_req, res) =>
      sendJson(res, 200, { success: false, error: 'Pix QR Code not found' });
    const c = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect((c as GatewayError).notFound).toBe(true);
  });

  it.each([
    [500, { success: false, error: 'boom' }],
    [401, { error: 'Token de autenticação inválido ou ausente.' }],
    [429, { success: false, error: 'devagar' }],
  ])('HTTP %i NÃO é notFound (transitório: o webhook responde 5xx)', async (status, body) => {
    fake.responder = (_req, res) => sendJson(res, status, body);
    const error = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).notFound).toBe(false);
    expect((error as GatewayError).message).not.toContain(API_KEY);
  });

  it('success:false com outro erro e JSON inválido viram GatewayError não notFound', async () => {
    fake.responder = (_req, res) => sendJson(res, 200, { success: false, error: 'falha geral' });
    const a = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect((a as GatewayError).notFound).toBe(false);
    fake.responder = (_req, res) => {
      res.writeHead(200);
      res.end('<html>não é json</html>');
    };
    const b = await gateway()
      .getPayment('pix_char_x')
      .catch((e: unknown) => e);
    expect(b).toBeInstanceOf(GatewayError);
    expect((b as GatewayError).notFound).toBe(false);
  });

  it('resposta sem status vira GatewayError', async () => {
    fake.responder = (_req, res) =>
      sendJson(res, 200, { success: true, data: { id: 'pix_char_x' } });
    await expect(gateway().getPayment('pix_char_x')).rejects.toBeInstanceOf(GatewayError);
  });

  it('timeout: GatewayError', async () => {
    fake.responder = () => new Promise(() => undefined);
    await expect(gateway({ timeoutMs: 80 }).getPayment('pix_char_x')).rejects.toBeInstanceOf(
      GatewayError,
    );
  });
});

describe('AbacatePayGateway: identidade', () => {
  it('name = abacatepay', () => {
    expect(gateway().name).toBe('abacatepay');
  });

  it('exige a chave de API (nunca sobe sem ela)', () => {
    expect(() => new AbacatePayGateway({ apiKey: '', apiUrl: fake.url })).toThrow(/chave/i);
  });
});
