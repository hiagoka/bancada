import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inflateSync } from 'node:zlib';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { AbacatePayGateway } from '../src/modules/payments/abacatepay.gateway.js';
import { verifyAbacatePayWebhook } from '../src/modules/payments/abacatepay.signature.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import {
  renderPlaceholderQrPng,
  startFakeAbacatePay,
  type FakeAbacatePayServer,
} from '../scripts/fake-abacatepay.js';
import { resetDb } from './db-helpers.js';
import { authDeps, silentLogger, testDatabaseUrl } from './helpers.js';

// A ferramenta de desenvolvimento (npm run dev:fake-abacatepay) de ponta a ponta: cria cobrança,
// consulta, paga e confere que o webhook chega com o secret e a assinatura certos.
const SECRET = 'segredo-do-webhook-com-no-minimo-32-caracteres';
const API_KEY = 'abc_dev_local';
const ORDER_ID = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';

interface Delivery {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

let receiver: Server;
let deliveries: Delivery[];
let receiverStatus = 200;
let receiverUrl: string;
let fake: FakeAbacatePayServer;

beforeEach(async () => {
  deliveries = [];
  receiverStatus = 200;
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      deliveries.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        rawBody: Buffer.concat(chunks),
      });
      res.writeHead(receiverStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { outcome: 'applied' } }));
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/webhooks/abacatepay`;
  fake = await startFakeAbacatePay({
    webhookUrl: receiverUrl,
    webhookSecret: SECRET,
    strict: true,
  });
});

afterEach(async () => {
  await fake.close();
  await new Promise<void>((resolve) => {
    receiver.closeAllConnections();
    receiver.close(() => resolve());
  });
});

function gateway(): AbacatePayGateway {
  return new AbacatePayGateway({ apiKey: API_KEY, apiUrl: fake.url });
}
const checkoutRequest = (seconds = 1800) => ({
  orderId: ORDER_ID,
  items: [{ name: 'Mouse', unitPriceCents: 24900, quantity: 2 }],
  totalCents: 49800,
  expiresAt: new Date(Date.now() + seconds * 1000),
});
const payUrl = (id: string) => `${fake.url.replace(/\/v2$/, '')}/__pay/${id}`;

describe('POST /v2/transparents/create', () => {
  it('devolve pix_char_<n>, brCode, QR Code PNG e expiresAt coerente com expiresIn', async () => {
    const before = Date.now();
    const result = await gateway().createCheckout(checkoutRequest(1800));
    expect(result.checkoutId).toMatch(/^pix_char_[A-Za-z0-9]+$/);
    expect(result.checkoutUrl).toBeNull();
    expect(result.pix?.brCode).toMatch(/^000201/);
    expect(result.pix?.qrCodeImage.startsWith('data:image/png;base64,')).toBe(true);
    // expiresIn = 1800 - 30 s de margem do gateway: a validade é "agora" + expiresIn
    const expiresMs = result.pix!.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 1770_000 - 2000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 1770_000 + 2000);
  });

  it('cada cobrança tem um id novo (pix_char_1, pix_char_2...)', async () => {
    const a = await gateway().createCheckout(checkoutRequest());
    const b = await gateway().createCheckout(checkoutRequest());
    expect(a.checkoutId).not.toBe(b.checkoutId);
  });

  it.each([
    ['sem Authorization', {}, 401],
    ['amount abaixo de 100 centavos', { amount: 99, expiresIn: 1800 }, 400],
    ['amount não inteiro', { amount: 100.5, expiresIn: 1800 }, 400],
    ['expiresIn abaixo de 300 s', { amount: 1000, expiresIn: 299 }, 400],
    ['sem expiresIn válido', { amount: 1000, expiresIn: 'x' }, 400],
  ] as const)('recusa como a AbacatePay: %s', async (_nome, data, status) => {
    const res = await fetch(`${fake.url}/transparents/create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(status === 401 ? {} : { authorization: `Bearer ${API_KEY}` }),
      },
      body: JSON.stringify({ method: 'PIX', data }),
    });
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe('string');
  });
});

describe('GET /v2/transparents/check', () => {
  it('cobrança nova: PENDING; id desconhecido: 404 "Pix QR Code not found"', async () => {
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    expect((await gateway().getPayment(checkoutId)).rawStatus).toBe('PENDING');
    await expect(gateway().getPayment('pix_char_nao_existe')).rejects.toMatchObject({
      notFound: true,
    });
  });
});

describe('POST /__pay/:id', () => {
  it('marca a cobrança como PAID e ENTREGA transparent.completed com secret e assinatura corretos', async () => {
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    const res = await fetch(payUrl(checkoutId), { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paid: true, webhook: { status: 200 } });

    // o status mudou para PAID
    expect((await gateway().getPayment(checkoutId)).rawStatus).toBe('PAID');

    // o webhook chegou UMA vez, cru, com os dois headers conferindo
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0]!;
    expect(delivery.method).toBe('POST');
    expect(delivery.url).toBe('/webhooks/abacatepay');
    expect(delivery.headers['content-type']).toContain('application/json');
    expect(
      verifyAbacatePayWebhook({
        rawBody: delivery.rawBody,
        secretHeader: String(delivery.headers['x-webhook-secret']),
        signatureHeader: String(delivery.headers['x-webhook-signature']),
        expectedSecret: SECRET,
      }),
    ).toBe(true);
    const payload = JSON.parse(delivery.rawBody.toString('utf8')) as {
      id: string;
      event: string;
      data: { transparent: { id: string; status: string } };
    };
    expect(payload.event).toBe('transparent.completed');
    expect(payload.id).toMatch(/^log_/);
    expect(payload.data.transparent).toMatchObject({ id: checkoutId, status: 'PAID' });
  });

  it('a assinatura é sobre os bytes CRUS entregues (qualquer alteração a invalida)', async () => {
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    await fetch(payUrl(checkoutId), { method: 'POST' });
    const delivery = deliveries[0]!;
    const tampered = Buffer.from(`${delivery.rawBody.toString('utf8')} `);
    expect(
      verifyAbacatePayWebhook({
        rawBody: tampered,
        secretHeader: String(delivery.headers['x-webhook-secret']),
        signatureHeader: String(delivery.headers['x-webhook-signature']),
        expectedSecret: SECRET,
      }),
    ).toBe(false);
  });

  it('cobrança desconhecida: 404 e nada é entregue', async () => {
    const res = await fetch(payUrl('pix_char_nao_existe'), { method: 'POST' });
    expect(res.status).toBe(404);
    expect(deliveries).toHaveLength(0);
  });

  it('pagar duas vezes: a segunda dá 409 e não entrega de novo', async () => {
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    expect((await fetch(payUrl(checkoutId), { method: 'POST' })).status).toBe(200);
    expect((await fetch(payUrl(checkoutId), { method: 'POST' })).status).toBe(409);
    expect(deliveries).toHaveLength(1);
  });

  it('só aceita POST', async () => {
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    expect((await fetch(payUrl(checkoutId))).status).toBe(404);
    expect(deliveries).toHaveLength(0);
  });

  it('a API recusando o webhook (ex.: segredo diferente): a resposta conta o que aconteceu', async () => {
    receiverStatus = 401;
    const { checkoutId } = await gateway().createCheckout(checkoutRequest());
    const res = await fetch(payUrl(checkoutId), { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paid: true, webhook: { status: 401 } });
  });

  it('API fora do ar: 502 explicando, e a cobrança já está PAID (como na AbacatePay real)', async () => {
    const down = await startFakeAbacatePay({
      webhookUrl: 'http://127.0.0.1:1/webhooks/abacatepay',
      webhookSecret: SECRET,
      strict: true,
    });
    try {
      const g = new AbacatePayGateway({ apiKey: API_KEY, apiUrl: down.url });
      const { checkoutId } = await g.createCheckout(checkoutRequest());
      const res = await fetch(`${down.url.replace(/\/v2$/, '')}/__pay/${checkoutId}`, {
        method: 'POST',
      });
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toMatch(/webhook/i);
      expect((await g.getPayment(checkoutId)).rawStatus).toBe('PAID');
    } finally {
      await down.close();
    }
  });

  it('sem ABACATEPAY_WEBHOOK_SECRET configurado: 500 com instrução, sem entregar nada', async () => {
    const noSecret = await startFakeAbacatePay({ webhookUrl: receiverUrl, strict: true });
    try {
      const g = new AbacatePayGateway({ apiKey: API_KEY, apiUrl: noSecret.url });
      const { checkoutId } = await g.createCheckout(checkoutRequest());
      const res = await fetch(`${noSecret.url.replace(/\/v2$/, '')}/__pay/${checkoutId}`, {
        method: 'POST',
      });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toContain(
        'ABACATEPAY_WEBHOOK_SECRET',
      );
      expect(deliveries).toHaveLength(0);
    } finally {
      await noSecret.close();
    }
  });
});

describe('o QR Code de desenvolvimento', () => {
  it('é um PNG válido (assinatura, IHDR e dados que descomprimem), determinístico e quadrado', () => {
    const png = renderPlaceholderQrPng('00020101021226950014br.gov.bcb.pix');
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(200);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(0); // escala de cinza
    // junta os IDAT e descomprime: height linhas de (1 filtro + width pixels)
    const idat: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    expect(png.subarray(png.length - 12, png.length - 8).readUInt32BE(0)).toBe(0); // IEND vazio
    expect(inflateSync(Buffer.concat(idat)).length).toBe(height * (width + 1));
    expect(renderPlaceholderQrPng('00020101021226950014br.gov.bcb.pix').equals(png)).toBe(true);
    expect(renderPlaceholderQrPng('outro código').equals(png)).toBe(false);
  });

  it('tem módulos escuros e claros (não é uma imagem em branco) e os 3 cantos de localização', () => {
    const png = renderPlaceholderQrPng('qualquer');
    const idat: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      if (png.subarray(offset + 4, offset + 8).toString('ascii') === 'IDAT') {
        idat.push(png.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    const width = png.readUInt32BE(16);
    const raw = inflateSync(Buffer.concat(idat));
    const pixels = new Set<number>();
    for (let i = 0; i < raw.length; i += 1) if (i % (width + 1) !== 0) pixels.add(raw[i]!);
    expect([...pixels].sort()).toEqual([0, 255]);
    const at = (x: number, y: number) => raw[y * (width + 1) + 1 + x];
    const module = Math.round(width / 37); // 29 módulos + 4 de margem de cada lado
    // o primeiro módulo do canto superior esquerdo do localizador é escuro
    expect(at(4 * module + 1, 4 * module + 1)).toBe(0);
    expect(at(1, 1)).toBe(255); // a margem (quiet zone) é clara
  });

  it('a imagem passa na validação do gateway (data URI PNG)', async () => {
    const result = await gateway().createCheckout(checkoutRequest());
    expect(result.pix?.qrCodeImage).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  });
});

describe('ponta a ponta com a API de verdade', () => {
  const pool = createPool(testDatabaseUrl());
  let apiServer: Server;

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      apiServer?.closeAllConnections();
      apiServer?.close(() => resolve());
    });
  });

  it('PAYMENT_PROVIDER=abacatepay: cria o pedido, paga por /__pay e o pedido vira PAID sozinho', async () => {
    await resetDb(pool);
    const wired = await startFakeAbacatePay({ webhookSecret: SECRET, strict: true });
    try {
      const app = createApp({
        ...authDeps,
        pool,
        logger: silentLogger,
        webUrl: 'http://localhost:5173',
        storage: new FakeStorageService(),
        gateway: new AbacatePayGateway({ apiKey: API_KEY, apiUrl: wired.url }),
        webhookSecret: SECRET,
      });
      apiServer = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => apiServer.once('listening', resolve));
      // ABACATEPAY_FAKE_WEBHOOK_URL: o servidor falso entrega o webhook na API de verdade
      wired.setWebhookUrl(
        `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/webhooks/abacatepay`,
      );

      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM products WHERE slug LIKE '%mouse%'`,
      );
      const created = await request(app)
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          customer: { name: 'Ana Souza', email: 'ana@example.com' },
          items: [{ productId: rows[0]!.id, quantity: 1 }],
        });
      expect(created.status).toBe(201);
      expect(created.body.data.pix.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      const orderId = created.body.data.id as string;
      const { rows: orderRows } = await pool.query<{ checkout_id: string }>(
        'SELECT checkout_id FROM orders WHERE id = $1',
        [orderId],
      );

      const paid = await fetch(
        `${wired.url.replace(/\/v2$/, '')}/__pay/${orderRows[0]!.checkout_id}`,
        { method: 'POST' },
      );
      expect(paid.status).toBe(200);
      expect(await paid.json()).toMatchObject({ paid: true, webhook: { status: 200 } });

      const order = await request(app).get(`/orders/${orderId}`);
      expect(order.body.data.status).toBe('PAID');
      expect(order.body.data.pix).toBeNull();
      const { rows: events } = await pool.query(
        'SELECT provider, status, outcome FROM payment_events',
      );
      expect(events).toEqual([{ provider: 'abacatepay', status: 'PAID', outcome: 'applied' }]);
    } finally {
      await wired.close();
    }
  });
});
