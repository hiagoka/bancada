import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';
import { FakeStorageService } from '../src/modules/storage/fake.storage.js';
import { resetDb } from './db-helpers.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const pool = createPool(testDatabaseUrl());
const webUrl = 'http://localhost:5173';
let gateway: FakePaymentGateway;
let clock: Date | null;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await resetDb(pool);
  gateway = new FakePaymentGateway({ webUrl });
  clock = null;
  app = createApp({
    pool,
    logger: silentLogger,
    webUrl,
    storage: new FakeStorageService(),
    gateway,
    now: () => clock ?? new Date(),
  });
});

afterAll(async () => {
  await pool.end();
});

const customer = { name: 'Ana Souza', email: 'ana@example.com' };

async function mouseId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM products WHERE slug LIKE '%mouse%'`,
  );
  return rows[0]!.id;
}

async function post(key: string = randomUUID(), quantity = 2) {
  return request(app)
    .post('/orders')
    .set('Idempotency-Key', key)
    .send({ customer, items: [{ productId: await mouseId(), quantity }] });
}

async function orderRows() {
  const { rows } = await pool.query('SELECT * FROM orders');
  return rows;
}

async function orderMovements(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM stock_movements WHERE reason = 'order'`,
  );
  return rows[0].n;
}

async function mouseStock(): Promise<number> {
  const { rows } = await pool.query(`SELECT stock FROM products WHERE slug LIKE '%mouse%'`);
  return rows[0].stock;
}

describe('checkout depois do COMMIT', () => {
  it('pedido novo já volta com checkoutUrl e grava checkout_id/checkout_url', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const [row] = await orderRows();
    expect(res.body.data.checkoutUrl).toBe(`${webUrl}/checkout-simulado/${row.id}`);
    expect(row.checkout_id).toBe(`fake-checkout-${row.id}`);
    expect(row.checkout_url).toBe(res.body.data.checkoutUrl);
  });

  it('payment_provider gravado = gateway.name', async () => {
    await post();
    const [row] = await orderRows();
    expect(row.payment_provider).toBe(gateway.name);
    expect(row.payment_provider).toBe('fake');
  });

  it('o gateway recebe orderId, itens com preço do banco, total e expiração em created_at + 30 min (D14)', async () => {
    const res = await post(randomUUID(), 2);
    const [row] = await orderRows();
    expect(gateway.createCheckoutCalls).toBe(1);
    expect(gateway.lastCheckoutRequest).toEqual({
      orderId: res.body.data.id,
      items: [{ name: 'Mouse Sem Fio Ergonômico', unitPriceCents: 24900, quantity: 2 }],
      totalCents: 49800,
      expiresAt: new Date(row.created_at.getTime() + 30 * 60 * 1000),
    });
  });

  it('a chamada ao gateway acontece FORA da transação (nenhum lock segurado durante o checkout)', async () => {
    const slow = new FakePaymentGateway({ webUrl, delayMs: 300 });
    const slowApp = createApp({
      pool,
      logger: silentLogger,
      webUrl,
      storage: new FakeStorageService(),
      gateway: slow,
    });
    const pending = request(slowApp)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ customer, items: [{ productId: await mouseId(), quantity: 1 }] })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 100));
    // Com o gateway ainda "pensando", o produto precisa estar destravado.
    const started = Date.now();
    await pool.query(`UPDATE products SET updated_at = now() WHERE slug LIKE '%mouse%'`);
    expect(Date.now() - started).toBeLessThan(150);
    expect((await pending).status).toBe(201);
  });
});

describe('falha do gateway', () => {
  it('502 CHECKOUT_UNAVAILABLE com details.orderId; pedido e reserva de estoque persistem', async () => {
    gateway.failNextCheckout(1);
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(typeof res.body.error.message).toBe('string');

    const [row] = await orderRows();
    expect(res.body.error.details).toEqual({ orderId: row.id });
    expect(row.status).toBe('PENDING');
    expect(row.checkout_id).toBeNull();
    expect(row.checkout_url).toBeNull();
    expect(await mouseStock()).toBe(18);
    expect(await orderMovements()).toBe(1);
  });

  it('retry com a MESMA chave conclui o checkout sem duplicar pedido nem estoque', async () => {
    const key = randomUUID();
    gateway.failNextCheckout(1);
    const failed = await post(key);
    expect(failed.status).toBe(502);

    const retry = await post(key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(failed.body.error.details.orderId);
    expect(retry.body.data.checkoutUrl).toBe(`${webUrl}/checkout-simulado/${retry.body.data.id}`);

    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].checkout_url).toBe(retry.body.data.checkoutUrl);
    expect(await mouseStock()).toBe(18);
    expect(await orderMovements()).toBe(1);
  });

  it('duas falhas seguidas e depois sucesso, sempre no mesmo pedido', async () => {
    const key = randomUUID();
    gateway.failNextCheckout(2);
    const a = await post(key);
    const b = await post(key);
    const c = await post(key);
    expect([a.status, b.status, c.status]).toEqual([502, 502, 200]);
    expect(b.body.error.details.orderId).toBe(a.body.error.details.orderId);
    expect(c.body.data.id).toBe(a.body.error.details.orderId);
    expect(await orderRows()).toHaveLength(1);
    expect(await mouseStock()).toBe(18);
  });

  it('o retry com outro corpo continua dando 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    gateway.failNextCheckout(1);
    await post(key, 2);
    const other = await post(key, 3);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a resposta de erro não vaza dados do cliente nem detalhes do gateway', async () => {
    gateway.failNextCheckout(1);
    const res = await post();
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Ana Souza');
    expect(text).not.toContain('ana@example.com');
    expect(Object.keys(res.body.error.details)).toEqual(['orderId']);
  });

  it('retry depois que a Preference já expirou (created_at + 30 min): 502, sem chamar o gateway', async () => {
    const key = randomUUID();
    gateway.failNextCheckout(1);
    await post(key);
    const calls = gateway.createCheckoutCalls;
    const [row] = await orderRows();
    clock = new Date(row.created_at.getTime() + 30 * 60 * 1000 + 1000);

    const retry = await post(key);
    expect(retry.status).toBe(502);
    expect(retry.body.error.code).toBe('CHECKOUT_UNAVAILABLE');
    expect(retry.body.error.details).toEqual({ orderId: row.id, reason: 'expired' });
    expect(retry.body.error.message).not.toContain('mesma chave');
    expect(gateway.createCheckoutCalls).toBe(calls);
    expect((await orderRows())[0].checkout_url).toBeNull();
  });
});

describe('corrida na gravação do checkout', () => {
  it('se outra requisição grava o checkout durante a chamada ao gateway, o dela vale', async () => {
    class RacingGateway extends FakePaymentGateway {
      override async createCheckout(req: Parameters<FakePaymentGateway['createCheckout']>[0]) {
        await pool.query(
          `UPDATE orders SET checkout_id = 'vencedor', checkout_url = 'https://vencedor.test'
           WHERE id = $1`,
          [req.orderId],
        );
        return { checkoutId: 'perdedor', checkoutUrl: 'https://perdedor.test' };
      }
    }
    const racingApp = createApp({
      pool,
      logger: silentLogger,
      webUrl,
      storage: new FakeStorageService(),
      gateway: new RacingGateway({ webUrl }),
    });
    const res = await request(racingApp)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ customer, items: [{ productId: await mouseId(), quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.checkoutUrl).toBe('https://vencedor.test');
    const [row] = await orderRows();
    expect(row.checkout_id).toBe('vencedor');
    expect(row.checkout_url).toBe('https://vencedor.test');
  });
});

describe('replay e checkout', () => {
  it('replay com checkout existente não chama o gateway', async () => {
    const key = randomUUID();
    const first = await post(key);
    const calls = gateway.createCheckoutCalls;
    const replay = await post(key);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(gateway.createCheckoutCalls).toBe(calls);
  });

  it.each(['PAID', 'CANCELLED', 'REFUNDED'])(
    'replay de pedido %s sem checkout não tenta criar checkout',
    async (status) => {
      const key = randomUUID();
      gateway.failNextCheckout(1);
      await post(key);
      await pool.query('UPDATE orders SET status = $1', [status]);
      const calls = gateway.createCheckoutCalls;
      const replay = await post(key);
      expect(replay.status).toBe(200);
      expect(replay.body.data.status).toBe(status);
      expect(replay.body.data.checkoutUrl).toBeNull();
      expect(gateway.createCheckoutCalls).toBe(calls);
    },
  );

  it('retries simultâneos não geram dois checkouts diferentes', async () => {
    const slow = new FakePaymentGateway({ webUrl, delayMs: 80 });
    const slowApp = createApp({
      pool,
      logger: silentLogger,
      webUrl,
      storage: new FakeStorageService(),
      gateway: slow,
    });
    const key = randomUUID();
    const body = { customer, items: [{ productId: await mouseId(), quantity: 1 }] };
    const send = () => request(slowApp).post('/orders').set('Idempotency-Key', key).send(body);

    slow.failNextCheckout(1);
    expect((await send()).status).toBe(502);

    const results = await Promise.all(Array.from({ length: 6 }, send));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(new Set(results.map((r) => r.body.data.checkoutUrl)).size).toBe(1);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(slow.checkoutCount).toBe(1);
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].checkout_url).toBe(results[0]!.body.data.checkoutUrl);
    expect(await mouseStock()).toBe(19);
    expect(await orderMovements()).toBe(1);
  });

  it('replay enxerga e preserva um checkout gravado por outra requisição (sem chamar o gateway)', async () => {
    const key = randomUUID();
    gateway.failNextCheckout(1);
    await post(key);
    // Outra requisição "ganha" a corrida e grava o checkout enquanto esta ainda chama o gateway.
    await pool.query(
      `UPDATE orders SET checkout_id = 'vencedor', checkout_url = 'https://vencedor.test'`,
    );
    const retry = await post(key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.checkoutUrl).toBe('https://vencedor.test');
    expect((await orderRows())[0].checkout_id).toBe('vencedor');
  });
});
