import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { AbacatePayGateway } from '../src/modules/payments/abacatepay.gateway.js';
import { abacatePaySignature } from '../src/modules/payments/abacatepay.signature.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { resetDb } from './db-helpers.js';
import { sendJson, startFakeAbacatePay, type FakeAbacatePay } from './fake-abacatepay.js';
import { authDeps, silentLogger, testDatabaseUrl } from './helpers.js';

// POST /webhooks/abacatepay de ponta a ponta: assinatura sobre o corpo cru, reconsulta do status no
// /transparents/check (servidor HTTP falso) e a máquina de estados com PostgreSQL real.
const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';
const API_KEY = 'abc_dev_chave-de-api-que-nunca-pode-vazar';
const WEBHOOK_SECRET = 'segredo-do-webhook-com-no-minimo-32-caracteres';
const customer = { name: 'Ana Souza', email: 'ana@example.com' };

let fake: FakeAbacatePay;
let app: Express;

function buildApp(logger = silentLogger, secret: string | null = WEBHOOK_SECRET): Express {
  return createApp({
    ...authDeps,
    pool,
    logger,
    webUrl,
    storage: new FakeStorageService(),
    gateway: new AbacatePayGateway({ apiKey: API_KEY, apiUrl: fake.url }),
    webhookSecret: secret ?? undefined,
  });
}

beforeEach(async () => {
  await resetDb(pool);
  fake = await startFakeAbacatePay();
  app = buildApp();
});

afterEach(async () => {
  await fake.close();
});

afterAll(async () => {
  await pool.end();
});

async function productId(part: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM products WHERE slug LIKE $1', [
    `%${part}%`,
  ]);
  return rows[0]!.id;
}

interface Created {
  orderId: string;
  pixId: string;
  totalCents: number;
}

async function createOrder(quantity = 2, target: Express = app): Promise<Created> {
  const res = await request(target)
    .post('/orders')
    .set('Idempotency-Key', randomUUID())
    .send({ customer, items: [{ productId: await productId('mouse'), quantity }] });
  expect(res.status).toBe(201);
  const { rows } = await pool.query<{ checkout_id: string }>(
    'SELECT checkout_id FROM orders WHERE id = $1',
    [res.body.data.id],
  );
  return {
    orderId: res.body.data.id,
    pixId: rows[0]!.checkout_id,
    totalCents: res.body.data.totalCents,
  };
}

// Corpo de um evento como a AbacatePay manda (formato da documentação), com dados de cliente
// mascarados, que nunca devem ser lidos nem logados por nós.
function eventBody(event: string, pixId: string, status = 'PAID', logId = `log_${randomUUID()}`) {
  return JSON.stringify({
    id: logId,
    event,
    apiVersion: 2,
    devMode: true,
    data: {
      transparent: {
        id: pixId,
        externalId: null,
        amount: 5000,
        status,
        metadata: {},
      },
      customer: {
        id: 'cust_1',
        name: 'Maria Santos',
        email: 'maria@exemplo.com',
        taxId: '529.***.247-**',
      },
      payerInformation: { method: 'PIX', PIX: { name: 'Maria Santos', taxId: '529.***.247-**' } },
    },
  });
}

interface SendOptions {
  secret?: string | null;
  signature?: string | null;
  contentType?: string;
}

function send(rawBody: string, options: SendOptions = {}, target: Express = app) {
  let req = request(target)
    .post('/webhooks/abacatepay')
    .set('Content-Type', options.contentType ?? 'application/json');
  const secret = options.secret === undefined ? WEBHOOK_SECRET : options.secret;
  if (secret !== null) req = req.set('X-Webhook-Secret', secret);
  const signature =
    options.signature === undefined ? abacatePaySignature(rawBody) : options.signature;
  if (signature !== null) req = req.set('X-Webhook-Signature', signature);
  return req.send(rawBody);
}

const checkCalls = () => fake.requests.filter((r) => r.path.endsWith('/transparents/check'));

async function orderRow(orderId: string) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0];
}
async function events() {
  const { rows } = await pool.query('SELECT * FROM payment_events ORDER BY id');
  return rows;
}
async function mouseStock(): Promise<number> {
  const { rows } = await pool.query(`SELECT stock FROM products WHERE slug LIKE '%mouse%'`);
  return rows[0].stock;
}
async function expectLedgerConsistent(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
     GROUP BY p.id, p.stock HAVING p.stock <> COALESCE(SUM(m.delta), 0)`,
  );
  expect(rows).toEqual([]);
}

describe('assinatura e segredo', () => {
  it('secret e assinatura corretos: 200', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { outcome: 'applied' } });
  });

  it.each([
    ['assinatura ausente', { signature: null }],
    ['assinatura errada', { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
    ['assinatura vazia', { signature: '' }],
    ['assinatura de outro corpo', { signature: abacatePaySignature('{"outro":1}') }],
    ['secret ausente', { secret: null }],
    ['secret errado', { secret: 'outro-segredo-qualquer-com-mais-de-32-caracteres' }],
    ['secret só com o prefixo', { secret: WEBHOOK_SECRET.slice(0, 20) }],
    ['secret vazio', { secret: '' }],
  ] satisfies [string, SendOptions][])(
    '%s: 401 INVALID_SIGNATURE, nada é consultado nem gravado',
    async (_nome, options) => {
      const order = await createOrder();
      fake.checkStatuses.set(order.pixId, 'PAID');
      const res = await send(eventBody('transparent.completed', order.pixId), options);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      expect(checkCalls()).toHaveLength(0);
      expect((await orderRow(order.orderId)).status).toBe('PENDING');
      expect(await events()).toHaveLength(0);
    },
  );

  it('só o secret OU só a assinatura não bastam: as duas conferências são obrigatórias', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const body = eventBody('transparent.completed', order.pixId);
    expect((await send(body, { secret: 'errado' })).status).toBe(401); // assinatura certa
    expect((await send(body, { signature: 'errada' })).status).toBe(401); // secret certo
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('a assinatura é sobre os BYTES CRUS: o mesmo JSON reserializado é recusado', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const raw = `${JSON.stringify(JSON.parse(eventBody('transparent.completed', order.pixId)), null, 2)}\n`;
    const signature = abacatePaySignature(raw);
    // com os bytes exatos que foram assinados: aceito
    expect((await send(raw, { signature })).status).toBe(200);
    // o mesmo conteúdo, reserializado (outro espaçamento): a assinatura deixa de bater
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);
    const res = await send(reserialized, { signature });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('o secret na URL (?webhookSecret=) NÃO substitui o header', async () => {
    const order = await createOrder();
    const body = eventBody('transparent.completed', order.pixId);
    const res = await request(app)
      .post('/webhooks/abacatepay')
      .query({ webhookSecret: WEBHOOK_SECRET })
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', abacatePaySignature(body))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('corpo vazio ou sem Content-Type JSON: assinatura calculada sobre os bytes mesmo assim', async () => {
    const empty = await send('', { signature: abacatePaySignature('') });
    expect(empty.status).toBe(400); // assinatura válida, mas não é JSON
    const noType = await send(eventBody('transparent.refunded', 'pix_char_x'), {
      contentType: 'text/plain',
    });
    expect(noType.status).toBe(200); // a rota lê o corpo cru, qualquer que seja o Content-Type
  });

  it('JSON malformado COM assinatura válida: 400 INVALID_JSON', async () => {
    const raw = '{"event": "transparent.completed", ';
    const res = await send(raw);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sem webhookSecret configurado a rota nem existe: 404', async () => {
    const res = await send('{}', {}, buildApp(silentLogger, null));
    expect(res.status).toBe(404);
  });

  it('não exige o header CSRF (não é /auth nem /admin)', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.status).toBe(200);
  });
});

describe('eventos tratados e máquina de estados', () => {
  it('completed: PENDING -> PAID, com payment_id, paid_at, ledger consistente e evento com status bruto', async () => {
    const order = await createOrder();
    const stockAfterOrder = await mouseStock();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.body.data.outcome).toBe('applied');
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('PAID');
    expect(row.payment_id).toBe(order.pixId);
    expect(row.paid_at).not.toBeNull();
    expect(await mouseStock()).toBe(stockAfterOrder);
    await expectLedgerConsistent();
    expect(await events()).toEqual([
      expect.objectContaining({
        provider: 'abacatepay',
        payment_id: order.pixId,
        status: 'PAID',
        order_id: order.orderId,
        amount_cents: null,
        outcome: 'applied',
      }),
    ]);
  });

  it('localiza o pedido por checkout_id e reconsulta o /check com o id da cobrança', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    expect(checkCalls()).toHaveLength(1);
    expect(checkCalls()[0]!.query.get('id')).toBe(order.pixId);
    expect(checkCalls()[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('externalId do corpo NUNCA é usado para achar o pedido (aponte para outro pedido: ignorado)', async () => {
    const a = await createOrder();
    const b = await createOrder();
    fake.checkStatuses.set(a.pixId, 'PAID');
    const forged = JSON.stringify({
      id: 'log_x',
      event: 'transparent.completed',
      data: {
        transparent: { id: a.pixId, externalId: b.orderId, metadata: { orderId: b.orderId } },
      },
    });
    expect((await send(forged)).body.data.outcome).toBe('applied');
    expect((await orderRow(a.orderId)).status).toBe('PAID');
    expect((await orderRow(b.orderId)).status).toBe('PENDING');
  });

  it('completed, mas o /check ainda diz PENDING: 503 SEM efeito e SEM evento (a AbacatePay reenvia)', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PENDING');
    const body = eventBody('transparent.completed', order.pixId, 'PAID');
    const res = await send(body);
    expect(res.status).toBe(503);
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('PENDING');
    expect(row.payment_id).toBeNull();
    expect(row.paid_at).toBeNull();
    // nenhum evento gravado: a deduplicação NÃO pode bloquear o reenvio
    expect(await events()).toHaveLength(0);

    // o reenvio da AbacatePay chega quando o /check já mostra PAID: é processado normalmente
    fake.checkStatuses.set(order.pixId, 'PAID');
    const retry = await send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.data.outcome).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('PAID');
    expect(await events()).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('várias tentativas em 503 seguidas de um sucesso: um único evento e um único applied', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PENDING');
    const body = eventBody('transparent.completed', order.pixId);
    for (let i = 0; i < 3; i += 1) expect((await send(body)).status).toBe(503);
    fake.checkStatuses.set(order.pixId, 'PAID');
    expect((await send(body)).body.data.outcome).toBe('applied');
    expect((await send(body)).body.data.outcome).toBe('duplicate');
    expect(await events()).toHaveLength(1);
  });

  it('refunded e disputed com o /check ainda PENDING: 200 no_change (não há o que reenviar)', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PENDING');
    const refunded = await send(eventBody('transparent.refunded', order.pixId, 'REFUNDED'));
    expect(refunded.status).toBe(200);
    expect(refunded.body.data.outcome).toBe('no_change');
    const disputed = await send(eventBody('transparent.disputed', order.pixId, 'UNDER_DISPUTE'));
    expect(disputed.status).toBe(200);
    expect(disputed.body.data.outcome).toBe('duplicate'); // (cobrança, PENDING) já registrado
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('o corpo diz refunded, mas o /check diz PAID (ainda pago): usa o status do /check', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    const res = await send(eventBody('transparent.refunded', order.pixId, 'REFUNDED'));
    expect(res.body.data.outcome).toBe('duplicate'); // o /check ainda diz PAID: (cobrança, PAID) já processado
    expect((await orderRow(order.orderId)).status).toBe('PAID');
  });

  it('o mesmo evento reenviado (mesmo id de log): processado uma vez, o resto é duplicate', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const body = eventBody('transparent.completed', order.pixId, 'PAID', 'log_fixo');
    expect((await send(body)).body.data.outcome).toBe('applied');
    expect((await send(body)).body.data.outcome).toBe('duplicate');
    expect((await send(body)).body.data.outcome).toBe('duplicate');
    expect(await events()).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('reenvio manual pelo painel (id de log NOVO, mesma cobrança e status): duplicate', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId, 'PAID', 'log_um'));
    const again = await send(eventBody('transparent.completed', order.pixId, 'PAID', 'log_dois'));
    expect(again.body.data.outcome).toBe('duplicate');
    expect(await events()).toHaveLength(1);
  });

  it('5 entregas simultâneas do mesmo evento: exatamente um applied, sem deadlock', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const body = eventBody('transparent.completed', order.pixId);
    const results = await Promise.all(Array.from({ length: 5 }, () => send(body)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
    const outcomes = results.map((r) => r.body.data.outcome);
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(4);
    expect(await events()).toHaveLength(1);
  });

  it('refunded: PAID -> REFUNDED e o estoque NÃO volta (D13)', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    const stockPaid = await mouseStock();
    fake.checkStatuses.set(order.pixId, 'REFUNDED');
    const res = await send(eventBody('transparent.refunded', order.pixId, 'REFUNDED'));
    expect(res.body.data.outcome).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
    expect(await mouseStock()).toBe(stockPaid);
    const movements = await pool.query(
      `SELECT reason FROM stock_movements WHERE order_id = $1 ORDER BY id`,
      [order.orderId],
    );
    expect(movements.rows.map((r) => r.reason)).toEqual(['order']);
    await expectLedgerConsistent();
    expect((await events()).map((e) => e.status)).toEqual(['PAID', 'REFUNDED']);
  });

  async function paidOrder(): Promise<Created> {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    return order;
  }

  it('lost (disputa perdida, o /check mostra REFUNDED): PAID -> REFUNDED sem devolver estoque', async () => {
    const order = await paidOrder();
    const stockPaid = await mouseStock();
    fake.checkStatuses.set(order.pixId, 'REFUNDED');
    const res = await send(eventBody('transparent.lost', order.pixId, 'REFUNDED'));
    expect(res.body.data.outcome).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
    expect(await mouseStock()).toBe(stockPaid);
    await expectLedgerConsistent();
  });

  it.each(['EXPIRED', 'CANCELLED', 'FAILED', 'REDEEMED', 'APPROVED', 'ALGO_NOVO'])(
    'lost com o /check em %s (nem PAID, nem PENDING, nem UNDER_DISPUTE): REFUNDED sem devolver estoque (D13)',
    async (status) => {
      const order = await paidOrder();
      const stockPaid = await mouseStock();
      fake.checkStatuses.set(order.pixId, status);
      const res = await send(eventBody('transparent.lost', order.pixId, 'REFUNDED'));
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('applied');
      expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
      expect(await mouseStock()).toBe(stockPaid);
      const movements = await pool.query(`SELECT reason FROM stock_movements WHERE order_id = $1`, [
        order.orderId,
      ]);
      expect(movements.rows.map((r) => r.reason)).toEqual(['order']);
      await expectLedgerConsistent();
      expect((await events()).at(-1)).toMatchObject({ status, outcome: 'applied' });
    },
  );

  it.each(['PAID', 'PENDING', 'UNDER_DISPUTE'])(
    'lost com o /check ainda em %s: a perda não chegou ao /check, então 503 sem efeito (reenvio)',
    async (status) => {
      const order = await paidOrder();
      fake.checkStatuses.set(order.pixId, status);
      const body = eventBody('transparent.lost', order.pixId, 'REFUNDED');
      const res = await send(body);
      expect(res.status).toBe(503);
      expect((await orderRow(order.orderId)).status).toBe('PAID');
      expect((await events()).map((e) => e.status)).toEqual(['PAID']); // só o do pagamento
      // o reenvio, quando o /check já reflete a perda, é processado
      fake.checkStatuses.set(order.pixId, 'REFUNDED');
      expect((await send(body)).body.data.outcome).toBe('applied');
      expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
    },
  );

  it('lost e o /check dá 404: 503 (reenvio), sem evento', async () => {
    const order = await paidOrder();
    fake.responder = (req, res) => {
      if (!req.path.endsWith('/transparents/check')) return 'default';
      sendJson(res, 404, { success: false, error: 'Pix QR Code not found' });
    };
    const res = await send(eventBody('transparent.lost', order.pixId, 'REFUNDED'));
    expect(res.status).toBe(503);
    expect((await events()).map((e) => e.status)).toEqual(['PAID']);
  });

  it('lost num pedido ainda PENDING (nunca foi pago): invalid_transition, sem efeito', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'EXPIRED');
    const res = await send(eventBody('transparent.lost', order.pixId, 'REFUNDED'));
    expect(res.body.data.outcome).toBe('invalid_transition');
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('disputed (o /check mostra UNDER_DISPUTE): sem mudança no pedido, evento registrado', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    fake.checkStatuses.set(order.pixId, 'UNDER_DISPUTE');
    const res = await send(eventBody('transparent.disputed', order.pixId, 'UNDER_DISPUTE'));
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('no_change');
    expect((await orderRow(order.orderId)).status).toBe('PAID');
    expect((await events()).map((e) => [e.status, e.outcome])).toEqual([
      ['PAID', 'applied'],
      ['UNDER_DISPUTE', 'no_change'],
    ]);
  });

  it('disputa ganha (o /check volta a PAID): no_change, o pedido continua pago', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    await send(eventBody('transparent.completed', order.pixId));
    fake.checkStatuses.set(order.pixId, 'UNDER_DISPUTE');
    await send(eventBody('transparent.disputed', order.pixId, 'UNDER_DISPUTE'));
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.disputed', order.pixId, 'PAID'));
    expect(res.body.data.outcome).toBe('duplicate'); // (cobrança, PAID) já foi processado
    expect((await orderRow(order.orderId)).status).toBe('PAID');
  });

  it.each(['EXPIRED', 'CANCELLED', 'FAILED', 'REDEEMED', 'APPROVED', 'ALGO_NOVO'])(
    'completed com o /check em %s: não confirma o pagamento, então 503 sem efeito (nem cancela o pedido)',
    async (status) => {
      const order = await createOrder();
      fake.checkStatuses.set(order.pixId, status);
      const res = await send(eventBody('transparent.completed', order.pixId));
      expect(res.status).toBe(503);
      expect((await orderRow(order.orderId)).status).toBe('PENDING');
      expect(await events()).toHaveLength(0);
      expect(await mouseStock()).toBe(18);
    },
  );

  it.each([
    'transparent.created',
    'transparent.expired',
    'checkout.completed',
    'billing.paid',
    'payout.done',
    '',
    'TRANSPARENT.COMPLETED',
  ])('evento %j: 200 e ignora, sem consultar a API nem gravar nada', async (event) => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody(event, order.pixId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ignored: true } });
    expect(checkCalls()).toHaveLength(0);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
    expect(await events()).toHaveLength(0);
  });

  it('completed depois de CANCELLED (admin cancelou): invalid_transition, o pedido não é reativado', async () => {
    const order = await createOrder();
    await pool.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [order.orderId]);
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.body.data.outcome).toBe('invalid_transition');
    expect((await orderRow(order.orderId)).status).toBe('CANCELLED');
  });

  it('não existe amount_mismatch na AbacatePay: o valor não é informado, o Pix é fixado por nós', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.body.data.outcome).toBe('applied');
    expect((await events())[0].amount_cents).toBeNull();
  });
});

describe('entradas inesperadas e falhas', () => {
  it('cobrança desconhecida (sem pedido): 200 order_not_found, evento com order_id NULL', async () => {
    fake.checkStatuses.set('pix_char_sem_pedido', 'PAID');
    const res = await send(eventBody('transparent.completed', 'pix_char_sem_pedido'));
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('order_not_found');
    expect(await events()).toEqual([
      expect.objectContaining({ order_id: null, outcome: 'order_not_found', status: 'PAID' }),
    ]);
  });

  it('completed e o /check dá 404 (transitório): 503 sem evento; o reenvio com o /check certo paga', async () => {
    const order = await createOrder();
    fake.responder = (req, res) => {
      if (!req.path.endsWith('/transparents/check')) return 'default';
      sendJson(res, 404, { success: false, error: 'Pix QR Code not found' });
    };
    const body = eventBody('transparent.completed', order.pixId);
    expect((await send(body)).status).toBe(503);
    expect(await events()).toHaveLength(0);
    fake.responder = null;
    fake.checkStatuses.set(order.pixId, 'PAID');
    expect((await send(body)).body.data.outcome).toBe('applied');
  });

  it('refunded/disputed e o /check dá 404: 200 payment_not_found e NENHUM evento (não há o que reenviar)', async () => {
    const order = await createOrder();
    fake.responder = (req, res) => {
      if (!req.path.endsWith('/transparents/check')) return 'default';
      sendJson(res, 404, { success: false, error: 'Pix QR Code not found' });
    };
    for (const event of ['transparent.refunded', 'transparent.disputed']) {
      const res = await send(eventBody(event, order.pixId));
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('payment_not_found');
    }
    expect(await events()).toHaveLength(0);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('erro do provedor no /check (500): 5xx para a AbacatePay reenviar, NENHUM evento gravado; o retry funciona', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    fake.responder = (req, res) => {
      if (!req.path.endsWith('/transparents/check')) return 'default';
      sendJson(res, 500, { success: false, error: 'boom' });
    };
    const body = eventBody('transparent.completed', order.pixId);
    const failed = await send(body);
    expect(failed.status).toBe(500);
    expect(await events()).toHaveLength(0);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');

    fake.responder = null;
    const retry = await send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.data.outcome).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('PAID');
  });

  it('provedor fora do ar (conexão recusada): 5xx e nada gravado', async () => {
    const order = await createOrder();
    await fake.close();
    const res = await send(eventBody('transparent.completed', order.pixId));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await events()).toHaveLength(0);
    fake = await startFakeAbacatePay(); // para o afterEach
  });

  it.each([
    ['sem data', { event: 'transparent.completed' }],
    ['sem transparent', { event: 'transparent.completed', data: {} }],
    ['id não é texto', { event: 'transparent.completed', data: { transparent: { id: 42 } } }],
    ['id vazio', { event: 'transparent.completed', data: { transparent: { id: '' } } }],
    [
      'id gigante',
      { event: 'transparent.completed', data: { transparent: { id: 'x'.repeat(200) } } },
    ],
    [
      'id com caracteres perigosos',
      { event: 'transparent.completed', data: { transparent: { id: 'a b;DROP TABLE orders' } } },
    ],
    ['corpo é um array', ['transparent.completed']],
    ['corpo é null', null],
    ['corpo é texto', 'transparent.completed'],
  ])(
    'evento tratado com corpo inesperado (%s): 200 e ignorado, sem consultar a API',
    async (_nome, payload) => {
      const res = await send(JSON.stringify(payload));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { ignored: true } });
      expect(checkCalls()).toHaveLength(0);
      expect(await events()).toHaveLength(0);
    },
  );

  it('campos novos no payload não quebram (sem schema rígido)', async () => {
    const order = await createOrder();
    fake.checkStatuses.set(order.pixId, 'PAID');
    const body = JSON.stringify({
      id: 'log_novo',
      event: 'transparent.completed',
      apiVersion: 3,
      campoNovo: { qualquer: ['coisa'] },
      data: { transparent: { id: order.pixId, tambemNovo: true }, outroBloco: 1 },
    });
    expect((await send(body)).body.data.outcome).toBe('applied');
  });
});

describe('logs e privacidade', () => {
  function capture() {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    return { lines, logger };
  }

  it('a chave de API, o secret, a assinatura e os dados de cliente do payload NUNCA vão para o log', async () => {
    const { lines, logger } = capture();
    const logging = buildApp(logger);
    const order = await createOrder(2, logging);
    fake.checkStatuses.set(order.pixId, 'PAID');
    const body = eventBody('transparent.completed', order.pixId);
    await send(body, {}, logging); // aceito
    await send(body, { secret: 'secret-errado-que-nao-deve-aparecer-no-log' }, logging); // 401
    await send(body, { signature: 'assinatura-errada-que-nao-deve-aparecer' }, logging); // 401
    const out = lines.join('\n');
    expect(out).not.toContain(API_KEY);
    expect(out).not.toContain(WEBHOOK_SECRET);
    expect(out).not.toContain('secret-errado-que-nao-deve-aparecer-no-log');
    expect(out).not.toContain(abacatePaySignature(body));
    expect(out).not.toContain('assinatura-errada-que-nao-deve-aparecer');
    expect(out).not.toContain('Maria Santos');
    expect(out).not.toContain('maria@exemplo.com');
    expect(out).not.toContain('529.***.247-**');
    expect(out.toLowerCase()).not.toContain('x-webhook-secret');
    expect(out.toLowerCase()).not.toContain('x-webhook-signature');
  });

  it('a falha do provedor no webhook também não vaza a chave', async () => {
    const { lines, logger } = capture();
    const logging = buildApp(logger);
    const order = await createOrder(2, logging);
    fake.responder = (req, res) => {
      if (!req.path.endsWith('/transparents/check')) return 'default';
      sendJson(res, 401, { error: 'Token de autenticação inválido ou ausente.' });
    };
    const res = await send(eventBody('transparent.completed', order.pixId), {}, logging);
    expect(res.status).toBe(500);
    expect(lines.join('\n')).not.toContain(API_KEY);
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);
  });

  it('o log da requisição NÃO grava a query de /webhooks/* (segredo na URL, estilo da v1)', async () => {
    const { lines, logger } = capture();
    const logging = buildApp(logger);
    const body = eventBody('transparent.completed', 'pix_char_x');
    const res = await request(logging)
      .post('/webhooks/abacatepay')
      .query({ webhookSecret: 'SEGREDO-NA-URL-QUE-NAO-PODE-APARECER', outro: 'valor-na-query' })
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', abacatePaySignature(body))
      .send(body);
    expect(res.status).toBe(401);
    const out = lines.join('\n');
    expect(out).not.toContain('SEGREDO-NA-URL-QUE-NAO-PODE-APARECER');
    expect(out).not.toContain('valor-na-query');
    expect(out).not.toContain('webhookSecret');
    const logged = lines.map((l) => JSON.parse(l)).find((l) => l.req?.url?.startsWith('/webhooks'));
    expect(logged.req.url).toBe('/webhooks/abacatepay');
    expect(logged.req).not.toHaveProperty('query');
  });

  it('fora de /webhooks a query continua no log (só o webhook é tratado assim)', async () => {
    const { lines, logger } = capture();
    await request(buildApp(logger)).get('/products').query({ q: 'busca-visivel' });
    expect(lines.join('\n')).toContain('/products?q=busca-visivel');
  });

  it('assinatura inválida fica registrada em nível warn, sem o conteúdo da requisição', async () => {
    const { lines, logger } = capture();
    const logging = buildApp(logger);
    await send('{}', { signature: 'x' }, logging);
    const warn = lines.map((l) => JSON.parse(l)).find((l) => l.level === 40);
    expect(warn).toBeDefined();
    expect(String(warn.msg)).toContain('assinatura');
  });
});
