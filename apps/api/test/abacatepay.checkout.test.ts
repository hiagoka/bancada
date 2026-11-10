import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { AbacatePayGateway } from '../src/modules/payments/abacatepay.gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { resetDb } from './db-helpers.js';
import {
  FAKE_BR_CODE,
  FAKE_QR_IMAGE,
  sendJson,
  startFakeAbacatePay,
  type FakeAbacatePay,
} from './fake-abacatepay.js';
import { authDeps, silentLogger, testDatabaseUrl } from './helpers.js';

// Criação de pedido de ponta a ponta com o AbacatePayGateway de verdade falando com um servidor HTTP
// falso: POST /orders -> cobrança Pix -> pix no pedido, com retry e expiração (D19).
const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';
const API_KEY = 'abc_dev_chave-de-teste';
const customer = { name: 'Ana Souza', email: 'ana@example.com' };

let fake: FakeAbacatePay;
let clock: Date | null;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await resetDb(pool);
  fake = await startFakeAbacatePay();
  clock = null;
  const now = () => clock ?? new Date();
  app = createApp({
    ...authDeps,
    pool,
    logger: silentLogger,
    webUrl,
    storage: new FakeStorageService(),
    gateway: new AbacatePayGateway({ apiKey: API_KEY, apiUrl: fake.url, now }),
    now,
  });
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

async function post(key: string = randomUUID(), quantity = 2) {
  return request(app)
    .post('/orders')
    .set('Idempotency-Key', key)
    .send({ customer, items: [{ productId: await productId('mouse'), quantity }] });
}

const createCalls = () => fake.requests.filter((r) => r.path.endsWith('/transparents/create'));

describe('POST /orders com a AbacatePay', () => {
  it('cria a cobrança Pix com o valor do BANCO e devolve o pix (sem checkoutUrl)', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const [row] = (await pool.query('SELECT * FROM orders')).rows;
    expect(row.payment_provider).toBe('abacatepay');
    expect(row.total_cents).toBe(2 * 24900);
    const sent = createCalls()[0]!.json as { data: { amount: number; externalId: string } };
    expect(sent.data.amount).toBe(row.total_cents);
    expect(sent.data.externalId).toBe(row.id);
    expect(row.checkout_id).toMatch(/^pix_char_/);
    expect(row.checkout_url).toBeNull();
    expect(res.body.data.checkoutUrl).toBeNull();
    expect(res.body.data.pix).toEqual({
      brCode: FAKE_BR_CODE,
      qrCodeImage: FAKE_QR_IMAGE,
      expiresAt: expect.any(String),
    });
    // validade ancorada em created_at + 30 min (D19), com a folga de arredondamento do provedor
    const expiresAt = new Date(res.body.data.pix.expiresAt).getTime();
    const target = new Date(row.created_at).getTime() + 30 * 60 * 1000;
    expect(Math.abs(expiresAt - target)).toBeLessThan(5000);
  });

  it('o preço enviado pelo cliente continua ignorado', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        customer,
        items: [{ productId: await productId('mouse'), quantity: 1, priceCents: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(24900);
    const sent = createCalls()[0]!.json as { data: { amount: number } };
    expect(sent.data.amount).toBe(24900); // o valor do Pix é o do banco, não o do cliente
  });

  it('replay da mesma chave não cria outra cobrança', async () => {
    const key = randomUUID();
    const first = await post(key);
    const again = await post(key);
    expect(again.status).toBe(200);
    expect(createCalls()).toHaveLength(1);
    expect(again.body.data.pix).toEqual(first.body.data.pix);
  });

  it('falha do provedor: 502 e o pedido fica salvo; o retry conclui sem duplicar', async () => {
    const key = randomUUID();
    fake.responder = (_req, res) => {
      sendJson(res, 500, { success: false, error: 'boom' });
    };
    const failed = await post(key);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(failed.body.error.details.orderId).toEqual(expect.any(String));
    expect(failed.body.error.details.reason).toBeUndefined();
    expect((await pool.query('SELECT checkout_id FROM orders')).rows).toEqual([
      { checkout_id: null },
    ]);

    fake.responder = null;
    const retry = await post(key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.pix).not.toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order'`))
        .rows[0].n,
    ).toBe(1);
  });

  it('retry com menos de 300 s para expirar: 502 expired, SEM chamar a AbacatePay (D19)', async () => {
    const key = randomUUID();
    fake.responder = (_req, res) => {
      sendJson(res, 500, { success: false, error: 'boom' });
    };
    const failed = await post(key);
    expect(failed.status).toBe(502);
    const calls = fake.requests.length;
    const [{ created_at }] = (await pool.query('SELECT created_at FROM orders')).rows;
    // 26 min depois: faltam 4 min (240 s), abaixo do mínimo de 300 s do provedor
    clock = new Date(new Date(created_at).getTime() + 26 * 60 * 1000);
    fake.responder = null;
    const retry = await post(key);
    expect(retry.status).toBe(502);
    expect(retry.body.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(retry.body.error.details).toEqual({ orderId: expect.any(String), reason: 'expired' });
    expect(fake.requests).toHaveLength(calls);
  });

  it('retry com 5 min ou mais restantes ainda cria a cobrança, com expiresIn menor', async () => {
    const key = randomUUID();
    fake.responder = (_req, res) => {
      sendJson(res, 500, { success: false, error: 'boom' });
    };
    await post(key);
    const [{ created_at }] = (await pool.query('SELECT created_at FROM orders')).rows;
    clock = new Date(new Date(created_at).getTime() + 20 * 60 * 1000);
    fake.responder = null;
    const retry = await post(key);
    expect(retry.status).toBe(200);
    const sent = createCalls().at(-1)!.json as { data: { expiresIn: number } };
    expect(sent.data.expiresIn).toBe(10 * 60);
  });

  it('a chave de API não aparece em nenhuma resposta nem no corpo enviado', async () => {
    const res = await post();
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);
    for (const req of fake.requests) expect(req.rawBody).not.toContain(API_KEY);
  });

  it('GET /orders/:id mostra o pix enquanto PENDING e nunca dados do cliente', async () => {
    const created = await post();
    const id = created.body.data.id as string;
    const pending = await request(app).get(`/orders/${id}`);
    expect(pending.body.data.pix).toEqual(created.body.data.pix);
    const text = JSON.stringify(pending.body);
    expect(text).not.toContain('Ana Souza');
    expect(text).not.toContain('ana@example.com');
    await pool.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [id]);
    const paid = await request(app).get(`/orders/${id}`);
    expect(paid.body.data.pix).toBeNull();
    expect(JSON.stringify(paid.body)).not.toContain(FAKE_BR_CODE);
  });
});
