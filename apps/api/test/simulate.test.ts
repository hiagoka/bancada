import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import type { PaymentGateway } from '../src/modules/payments/payment-gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl, authDeps } from './helpers.js';

const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';
const gateway = new FakePaymentGateway({ webUrl });
const app = createApp({
  ...authDeps,
  pool,
  logger: silentLogger,
  webUrl,
  storage: new FakeStorageService(),
  gateway,
});

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

async function createOrder(quantity = 2) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM products WHERE slug LIKE '%mouse%'`,
  );
  const res = await request(app)
    .post('/orders')
    .set('Idempotency-Key', randomUUID())
    .send({
      customer: { name: 'Ana Souza', email: 'ana@example.com' },
      items: [{ productId: rows[0]!.id, quantity }],
    });
  return res.body.data as { id: string; totalCents: number };
}

const simulate = (body: Record<string, unknown>) =>
  request(app).post('/dev/payments/simulate').send(body);

describe('POST /dev/payments/simulate (gateway fake)', () => {
  it('ciclo completo: criar pedido -> simulate approved -> GET /orders/:id mostra PAID sem checkoutUrl', async () => {
    const order = await createOrder();
    expect(order).toMatchObject({ status: 'PENDING' });

    const res = await simulate({ orderId: order.id, status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { outcome: 'applied' } });

    const get = await request(app).get(`/orders/${order.id}`);
    expect(get.body.data.status).toBe('PAID');
    expect(get.body.data.checkoutUrl).toBeNull();
    expect(get.body.data.paidAt).toEqual(expect.any(String));
  });

  it('usa o MESMO fluxo do webhook: grava payment_events e orders.payment_id', async () => {
    const order = await createOrder();
    await simulate({ orderId: order.id, status: 'approved', paymentId: 'sim-1' });
    const { rows: events } = await pool.query('SELECT * FROM payment_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'fake',
      payment_id: 'sim-1',
      status: 'approved',
      order_id: order.id,
      amount_cents: order.totalCents,
      outcome: 'applied',
    });
    const { rows } = await pool.query('SELECT payment_id FROM orders WHERE id = $1', [order.id]);
    expect(rows[0].payment_id).toBe('sim-1');
  });

  it('o valor padrão é o total do pedido; amountCents divergente dá amount_mismatch', async () => {
    const order = await createOrder();
    const bad = await simulate({ orderId: order.id, status: 'approved', amountCents: 1 });
    expect(bad.body.data.outcome).toBe('amount_mismatch');
    const get = await request(app).get(`/orders/${order.id}`);
    expect(get.body.data.status).toBe('PENDING');
  });

  it('cancelled devolve o estoque e refunded não', async () => {
    const a = await createOrder(3);
    await simulate({ orderId: a.id, status: 'cancelled' });
    const { rows } = await pool.query(`SELECT stock FROM products WHERE slug LIKE '%mouse%'`);
    expect(rows[0].stock).toBe(20);

    const b = await createOrder(3);
    await simulate({ orderId: b.id, status: 'approved' });
    await simulate({ orderId: b.id, status: 'refunded' });
    const after = await pool.query(`SELECT stock FROM products WHERE slug LIKE '%mouse%'`);
    expect(after.rows[0].stock).toBe(17);
  });

  it('o mesmo paymentId e status repetido: duplicate', async () => {
    const order = await createOrder();
    await simulate({ orderId: order.id, status: 'approved', paymentId: 'x' });
    const again = await simulate({ orderId: order.id, status: 'approved', paymentId: 'x' });
    expect(again.body.data.outcome).toBe('duplicate');
  });

  it('pedido inexistente: 404 NOT_FOUND', async () => {
    const res = await simulate({ orderId: randomUUID(), status: 'approved' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('corpo inválido: 400 VALIDATION_ERROR em PT-BR', async () => {
    const res = await simulate({ orderId: 'x', status: 'pago' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('Pedido inválido');
  });

  it('com gateway mercadopago a rota nem existe: 404 padrão', async () => {
    const real: PaymentGateway = {
      name: 'mercadopago',
      createCheckout: (req) => gateway.createCheckout(req),
      getPayment: (id) => gateway.getPayment(id),
    };
    const mpApp = createApp({
      ...authDeps,
      pool,
      logger: silentLogger,
      webUrl,
      storage: new FakeStorageService(),
      gateway: real,
    });
    const res = await request(mpApp)
      .post('/dev/payments/simulate')
      .send({ orderId: randomUUID(), status: 'approved' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
