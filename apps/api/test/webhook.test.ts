import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import type { PaymentStatus } from '../src/modules/payments/payment-gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';
import { WEBHOOK_SECRET, notify, sign } from './webhook-helpers.js';

const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';
let gateway: FakePaymentGateway;
let app: Express;

function buildApp(logger = silentLogger, secret: string | null = WEBHOOK_SECRET): Express {
  return createApp({
    pool,
    logger,
    webUrl,
    storage: new FakeStorageService(),
    gateway,
    webhookSecret: secret ?? undefined,
  });
}

beforeEach(async () => {
  await resetDb(pool);
  gateway = new FakePaymentGateway({ webUrl });
  app = buildApp();
});

afterAll(async () => {
  await pool.end();
});

const customer = { name: 'Ana Souza', email: 'ana@example.com' };

async function idOf(part: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM products WHERE slug LIKE $1', [
    `%${part}%`,
  ]);
  return rows[0]!.id;
}

interface Created {
  orderId: string;
  totalCents: number;
}

async function createOrder(items: [string, number][] = [['mouse', 2]]): Promise<Created> {
  const res = await request(app)
    .post('/orders')
    .set('Idempotency-Key', randomUUID())
    .send({
      customer,
      items: await Promise.all(
        items.map(async ([p, q]) => ({ productId: await idOf(p), quantity: q })),
      ),
    });
  expect(res.status).toBe(201);
  return { orderId: res.body.data.id, totalCents: res.body.data.totalCents };
}

let paymentSeq = 0;
function pay(
  order: Created,
  status: PaymentStatus | 'unknown',
  extra: { id?: string; amountCents?: number; orderId?: string } = {},
): string {
  const id = extra.id ?? `pay-${++paymentSeq}`;
  gateway.registerPayment({
    id,
    status: status as PaymentStatus,
    orderId: extra.orderId ?? order.orderId,
    amountCents: extra.amountCents ?? order.totalCents,
  });
  return id;
}

async function outcomeOf(paymentId: string) {
  const res = await notify(app, paymentId);
  expect(res.status).toBe(200);
  return res.body.data.outcome as string;
}

async function orderRow(orderId: string) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0];
}

async function stockOf(part: string): Promise<number> {
  const { rows } = await pool.query('SELECT stock FROM products WHERE slug LIKE $1', [`%${part}%`]);
  return rows[0].stock;
}

async function events() {
  const { rows } = await pool.query('SELECT * FROM payment_events ORDER BY id');
  return rows;
}

async function expectLedgerConsistent(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
     GROUP BY p.id, p.stock HAVING p.stock <> COALESCE(SUM(m.delta), 0)`,
  );
  expect(rows).toEqual([]);
}

describe('POST /webhooks/mercadopago: entrada e assinatura', () => {
  it('assinatura válida: 200', async () => {
    const order = await createOrder();
    const res = await notify(app, pay(order, 'approved'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { outcome: 'applied' } });
  });

  it('a validação não usa janela de tempo (D6): ts antigo continua válido', async () => {
    const order = await createOrder();
    const res = await notify(app, pay(order, 'approved'), { ts: '1' });
    expect(res.status).toBe(200);
  });

  it('assinatura inválida: 401 INVALID_SIGNATURE no envelope, e nada é processado', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .query({ type: 'payment', 'data.id': id })
      .set('x-signature', `ts=1700000000,v1=${'0'.repeat(64)}`)
      .set('x-request-id', 'req-test-1')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
    expect(await events()).toHaveLength(0);
  });

  it('header x-signature ausente: 401', async () => {
    const order = await createOrder();
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .query({ type: 'payment', 'data.id': pay(order, 'approved') })
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('secret errado: 401', async () => {
    const order = await createOrder();
    const res = await notify(app, pay(order, 'approved'), { secret: 'outro-segredo' });
    expect(res.status).toBe(401);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('id adulterado (assinado para outro pagamento): 401', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    const res = await notify(app, id, { signedId: 'pay-outro' });
    expect(res.status).toBe(401);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('x-request-id adulterado: 401', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    const { xSignature } = sign(id, { requestId: 'req-a' });
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .query({ type: 'payment', 'data.id': id })
      .set('x-signature', xSignature)
      .set('x-request-id', 'req-b')
      .send({});
    expect(res.status).toBe(401);
  });

  it('data.id só no corpo também é aceito, desde que a assinatura cubra esse id', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    const { xSignature, xRequestId } = sign(id);
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .set('x-signature', xSignature)
      .set('x-request-id', xRequestId)
      .send({ type: 'payment', data: { id } });
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('applied');
  });

  it('type diferente de payment: 200 e ignora (sem exigir assinatura nem consultar o gateway)', async () => {
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .query({ type: 'merchant_order', 'data.id': '123' })
      .send({});
    expect(res.status).toBe(200);
    expect(gateway.getPaymentCalls).toBe(0);
    expect(await events()).toHaveLength(0);
  });

  it('type payment sem data.id: 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/webhooks/mercadopago')
      .query({ type: 'payment' })
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['a b', 'x'.repeat(65), '1;DROP TABLE orders'])(
    'data.id inválido (%s): 400',
    async (id) => {
      const res = await request(app)
        .post('/webhooks/mercadopago')
        .query({ type: 'payment', 'data.id': id })
        .send({});
      expect(res.status).toBe(400);
    },
  );

  it('sem webhookSecret (modo fake) a rota nem existe: 404', async () => {
    const res = await notify(buildApp(silentLogger, null), 'pay-1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('o log nunca contém o secret nem o x-signature', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const loggingApp = buildApp(logger);
    const order = await createOrder();
    const id = pay(order, 'approved');
    await notify(loggingApp, id);
    await notify(loggingApp, id, { secret: 'errado' });
    const { hash } = sign(id);
    const out = lines.join('\n');
    expect(out).not.toContain(WEBHOOK_SECRET);
    expect(out).not.toContain('errado');
    expect(out).not.toContain(hash);
    expect(out.toLowerCase()).not.toContain('x-signature');
  });
});

describe('máquina de estados aplicada', () => {
  it('aprovado: PENDING -> PAID, payment_id e paid_at gravados', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    expect(await outcomeOf(id)).toBe('applied');
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('PAID');
    expect(row.payment_id).toBe(id);
    expect(row.paid_at).toBeInstanceOf(Date);
    expect(await stockOf('mouse')).toBe(18);
  });

  it('o evento guarda provider, status, order_id, amount_cents e outcome', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    await outcomeOf(id);
    const [event, ...rest] = await events();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      provider: 'fake',
      payment_id: id,
      status: 'approved',
      order_id: order.orderId,
      amount_cents: order.totalCents,
      outcome: 'applied',
    });
    expect(event.received_at).toBeInstanceOf(Date);
  });

  it('recusado e depois aprovado: rejected não muda nada, approved paga', async () => {
    const order = await createOrder();
    expect(await outcomeOf(pay(order, 'rejected'))).toBe('no_change');
    let row = await orderRow(order.orderId);
    expect(row.status).toBe('PENDING');
    expect(row.payment_id).toBeNull();

    expect(await outcomeOf(pay(order, 'approved'))).toBe('applied');
    row = await orderRow(order.orderId);
    expect(row.status).toBe('PAID');
    expect((await events()).map((e) => e.outcome)).toEqual(['no_change', 'applied']);
  });

  it('o mesmo pagamento mudando de status (pending -> approved) gera um evento novo', async () => {
    const order = await createOrder();
    const id = pay(order, 'pending');
    expect(await outcomeOf(id)).toBe('no_change');
    pay(order, 'approved', { id });
    expect(await outcomeOf(id)).toBe('applied');
    expect(await events()).toHaveLength(2);
  });

  it.each(['pending', 'in_process', 'authorized', 'rejected'] as const)(
    '%s não muda o pedido (no_change)',
    async (status) => {
      const order = await createOrder();
      expect(await outcomeOf(pay(order, status))).toBe('no_change');
      expect((await orderRow(order.orderId)).status).toBe('PENDING');
    },
  );

  it('cancelado: PENDING -> CANCELLED e devolve o estoque com movimentos order_cancelled', async () => {
    const order = await createOrder([
      ['mouse', 2],
      ['hub', 5],
    ]);
    expect(await stockOf('mouse')).toBe(18);
    expect(await stockOf('hub')).toBe(7);

    expect(await outcomeOf(pay(order, 'cancelled'))).toBe('applied');
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('CANCELLED');
    expect(row.paid_at).toBeNull();
    expect(await stockOf('mouse')).toBe(20);
    expect(await stockOf('hub')).toBe(12);

    const { rows } = await pool.query(
      `SELECT product_id, delta, stock_after, admin_id FROM stock_movements
       WHERE order_id = $1 AND reason = 'order_cancelled' ORDER BY product_id`,
      [order.orderId],
    );
    expect(rows).toHaveLength(2);
    const byProduct = Object.fromEntries(rows.map((r) => [r.product_id, r]));
    expect(byProduct[await idOf('mouse')]).toMatchObject({
      delta: 2,
      stock_after: 20,
      admin_id: null,
    });
    expect(byProduct[await idOf('hub')]).toMatchObject({ delta: 5, stock_after: 12 });
    await expectLedgerConsistent();
  });

  it('estorno: PAID -> REFUNDED e o estoque NÃO volta (D13)', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'approved'));
    expect(await outcomeOf(pay(order, 'refunded'))).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
    expect(await stockOf('mouse')).toBe(18);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order_cancelled'`,
    );
    expect(rows[0].n).toBe(0);
    await expectLedgerConsistent();
  });

  it('chargeback também vira REFUNDED sem devolver estoque', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'approved'));
    expect(await outcomeOf(pay(order, 'charged_back'))).toBe('applied');
    expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
    expect(await stockOf('mouse')).toBe(18);
  });

  it('aprovado de novo no pedido já PAID (outro pagamento): no_change', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'approved'));
    expect(await outcomeOf(pay(order, 'approved'))).toBe('no_change');
    expect((await orderRow(order.orderId)).status).toBe('PAID');
  });

  it('valor adulterado: amount_mismatch, o pedido continua PENDING', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved', { amountCents: 1 });
    expect(await outcomeOf(id)).toBe('amount_mismatch');
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('PENDING');
    expect(row.payment_id).toBeNull();
    expect(row.paid_at).toBeNull();
    const [event] = await events();
    expect(event).toMatchObject({ amount_cents: 1, outcome: 'amount_mismatch' });
  });

  it('aprovado DEPOIS de CANCELLED: invalid_transition, o pedido não é reativado', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'cancelled'));
    const stockAfterCancel = await stockOf('mouse');
    expect(await outcomeOf(pay(order, 'approved'))).toBe('invalid_transition');
    const row = await orderRow(order.orderId);
    expect(row.status).toBe('CANCELLED');
    expect(row.paid_at).toBeNull();
    expect(await stockOf('mouse')).toBe(stockAfterCancel);
    expect((await events()).at(-1)).toMatchObject({ outcome: 'invalid_transition' });
    await expectLedgerConsistent();
  });

  it('cancelado DEPOIS de PAID: invalid_transition, estoque intacto', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'approved'));
    expect(await outcomeOf(pay(order, 'cancelled'))).toBe('invalid_transition');
    expect((await orderRow(order.orderId)).status).toBe('PAID');
    expect(await stockOf('mouse')).toBe(18);
  });

  it('REFUNDED não volta para PAID nem CANCELLED', async () => {
    const order = await createOrder();
    await outcomeOf(pay(order, 'approved'));
    await outcomeOf(pay(order, 'refunded'));
    expect(await outcomeOf(pay(order, 'approved'))).toBe('invalid_transition');
    expect(await outcomeOf(pay(order, 'cancelled'))).toBe('invalid_transition');
    expect((await orderRow(order.orderId)).status).toBe('REFUNDED');
  });

  it('a invalid_transition fica registrada com log em nível warn', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const loggingApp = buildApp(logger);
    const order = await createOrder();
    await outcomeOf(pay(order, 'cancelled'));
    await notify(loggingApp, pay(order, 'approved'));
    const warn = lines.map((l) => JSON.parse(l)).find((l) => l.level === 40);
    expect(warn).toBeDefined();
    expect(JSON.stringify(warn)).toContain(order.orderId);
  });

  it('pagamento de pedido inexistente: 200, evento com order_id NULL e outcome order_not_found', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved', { orderId: randomUUID() });
    expect(await outcomeOf(id)).toBe('order_not_found');
    const [event] = await events();
    expect(event).toMatchObject({ order_id: null, outcome: 'order_not_found', status: 'approved' });
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
  });

  it('external_reference que não é UUID também vira order_not_found (sem erro cru do pg)', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved', { orderId: 'não-é-uuid' });
    expect(await outcomeOf(id)).toBe('order_not_found');
  });

  it('segundo pagamento aprovado em pedido já PAID: no_change com alerta de cobrança em dobro', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const loggingApp = buildApp(logger);
    const order = await createOrder();
    await notify(loggingApp, pay(order, 'approved', { id: 'primeiro' }));
    const second = await notify(loggingApp, pay(order, 'approved', { id: 'segundo' }));
    expect(second.body.data.outcome).toBe('no_change');
    const alerts = lines.map((l) => JSON.parse(l)).filter((l) => l.level === 40);
    expect(alerts.some((l) => String(l.msg).includes('cobrança em dobro'))).toBe(true);
    expect((await orderRow(order.orderId)).payment_id).toBe('primeiro');
  });

  it('status desconhecido do MP: no_change, 200 e log warn', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const loggingApp = buildApp(logger);
    const order = await createOrder();
    const id = pay(order, 'unknown');
    const res = await notify(loggingApp, id);
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('no_change');
    expect((await orderRow(order.orderId)).status).toBe('PENDING');
    expect(lines.map((l) => JSON.parse(l)).some((l) => l.level === 40)).toBe(true);
  });
});

describe('duplicados e concorrência', () => {
  it('mesma notificação 5x em paralelo: exatamente um applied, os demais duplicate', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    const results = await Promise.all(Array.from({ length: 5 }, () => notify(app, id)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
    const outcomes = results.map((r) => r.body.data.outcome).sort();
    expect(outcomes).toEqual(['applied', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    expect(await events()).toHaveLength(1);
    expect((await orderRow(order.orderId)).status).toBe('PAID');
  });

  it('cancelamento 5x em paralelo devolve o estoque uma só vez', async () => {
    const order = await createOrder([['mouse', 4]]);
    const id = pay(order, 'cancelled');
    const results = await Promise.all(Array.from({ length: 5 }, () => notify(app, id)));
    expect(results.map((r) => r.body.data.outcome).filter((o) => o === 'applied')).toHaveLength(1);
    expect(await stockOf('mouse')).toBe(20);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order_cancelled'`,
    );
    expect(rows[0].n).toBe(1);
    await expectLedgerConsistent();
  });

  it('reenvio sequencial da mesma notificação: duplicate', async () => {
    const order = await createOrder();
    const id = pay(order, 'approved');
    expect(await outcomeOf(id)).toBe('applied');
    expect(await outcomeOf(id)).toBe('duplicate');
  });

  it('approved e cancelled simultâneos do mesmo pedido: um vence, o outro é invalid_transition', async () => {
    const order = await createOrder();
    const a = pay(order, 'approved');
    const c = pay(order, 'cancelled');
    const [ra, rc] = await Promise.all([notify(app, a), notify(app, c)]);
    const outcomes = [ra.body.data.outcome, rc.body.data.outcome].sort();
    expect(outcomes).toEqual(['applied', 'invalid_transition']);
    const status = (await orderRow(order.orderId)).status;
    expect(['PAID', 'CANCELLED']).toContain(status);
    await expectLedgerConsistent();
  });

  it('regressão do deadlock FK x FOR UPDATE: 15 rodadas de notificações simultâneas do mesmo pedido', async () => {
    for (let round = 0; round < 15; round++) {
      const order = await createOrder([['mouse', 1]]);
      const results = await Promise.all([
        notify(app, pay(order, 'approved')),
        notify(app, pay(order, 'cancelled')),
        notify(app, pay(order, 'pending')),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const outcomes = results.map((r) => r.body.data.outcome);
      expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    }
    await expectLedgerConsistent();
  });

  it('corrida: webhook CANCELLED x criação de pedidos do mesmo produto, sem deadlock', async () => {
    const order = await createOrder([['mouse', 5]]);
    expect(await stockOf('mouse')).toBe(15);
    const id = pay(order, 'cancelled');
    const mouse = await idOf('mouse');
    const creations = Array.from({ length: 6 }, () =>
      request(app)
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ customer, items: [{ productId: mouse, quantity: 1 }] }),
    );
    const [hook, ...created] = await Promise.all([notify(app, id), ...creations]);
    expect(hook!.status).toBe(200);
    expect(hook!.body.data.outcome).toBe('applied');
    expect(created.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(await stockOf('mouse')).toBe(15 + 5 - 6);
    await expectLedgerConsistent();
  });
});

describe('falhas e atomicidade', () => {
  it('pagamento inexistente no provedor (404): 200 payment_not_found, warn e NENHUM evento', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
    const loggingApp = buildApp(logger);
    const res = await notify(loggingApp, '123456');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { outcome: 'payment_not_found' } });
    expect(await events()).toHaveLength(0);
    expect(lines.map((l) => JSON.parse(l)).some((l) => l.level === 40)).toBe(true);
  });

  it('o pagamento que aparece depois é processado normalmente', async () => {
    const order = await createOrder();
    expect((await notify(app, 'pay-tardio')).body.data.outcome).toBe('payment_not_found');
    gateway.registerPayment({
      id: 'pay-tardio',
      status: 'approved',
      orderId: order.orderId,
      amountCents: order.totalCents,
    });
    expect((await notify(app, 'pay-tardio')).body.data.outcome).toBe('applied');
  });

  it('getPayment falhando por erro de rede/provedor: 5xx e NENHUM evento gravado; o retry funciona', async () => {
    const order = await createOrder();
    gateway.registerPayment({
      id: 'pay-futuro',
      status: 'approved',
      orderId: order.orderId,
      amountCents: order.totalCents,
    });
    gateway.failNextGetPayment(1);
    const failed = await notify(app, 'pay-futuro');
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(await events()).toHaveLength(0);
    expect((await orderRow(order.orderId)).status).toBe('PENDING');

    gateway.registerPayment({
      id: 'pay-futuro',
      status: 'approved',
      orderId: order.orderId,
      amountCents: order.totalCents,
    });
    const retry = await notify(app, 'pay-futuro');
    expect(retry.status).toBe(200);
    expect(retry.body.data.outcome).toBe('applied');
  });

  it('falha no meio da transação desfaz evento, pedido e estoque; o retry reprocessa', async () => {
    const order = await createOrder([['mouse', 3]]);
    const id = pay(order, 'cancelled');
    await pool.query(`
      CREATE FUNCTION t09_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha injetada'; END $$;
    `);
    await pool.query(`
      CREATE TRIGGER t09_fail_trg BEFORE INSERT ON stock_movements
      FOR EACH ROW WHEN (NEW.reason = 'order_cancelled') EXECUTE FUNCTION t09_fail();
    `);
    try {
      const res = await notify(app, id);
      expect(res.status).toBe(500);
      expect(await events()).toHaveLength(0);
      expect((await orderRow(order.orderId)).status).toBe('PENDING');
      expect(await stockOf('mouse')).toBe(17);
    } finally {
      await pool.query('DROP TRIGGER t09_fail_trg ON stock_movements');
      await pool.query('DROP FUNCTION t09_fail()');
    }
    const retry = await notify(app, id);
    expect(retry.body.data.outcome).toBe('applied');
    expect(await stockOf('mouse')).toBe(20);
    await expectLedgerConsistent();
  });
});
