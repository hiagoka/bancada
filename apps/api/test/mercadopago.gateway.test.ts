import { GatewayError } from '../src/modules/payments/payment-gateway.js';
import {
  MercadoPagoGateway,
  centsToReais,
  type MercadoPagoPaymentClient,
  type MercadoPagoPreferenceClient,
} from '../src/modules/payments/mercadopago.gateway.js';

const TOKEN = 'APP_USR-1234567890-super-secret-token';
const expiresAt = new Date('2026-03-10T15:30:00.000Z');

interface Calls {
  create: { body: Record<string, unknown>; requestOptions?: { idempotencyKey?: string } }[];
  get: { id: string | number }[];
}

function build(
  options: {
    webUrl?: string;
    apiPublicUrl?: string;
    createResult?: () => Promise<{ id?: string; init_point?: string }>;
    getResult?: () => Promise<Record<string, unknown>>;
  } = {},
) {
  const calls: Calls = { create: [], get: [] };
  const preference: MercadoPagoPreferenceClient = {
    create: async (data) => {
      calls.create.push(data as Calls['create'][number]);
      return options.createResult
        ? options.createResult()
        : { id: 'pref-1', init_point: 'https://mp.test/checkout/pref-1' };
    },
  };
  const payment: MercadoPagoPaymentClient = {
    get: async (data) => {
      calls.get.push(data);
      return (options.getResult ? options.getResult() : {}) as never;
    },
  };
  const gateway = new MercadoPagoGateway({
    accessToken: TOKEN,
    preference,
    payment,
    webUrl: options.webUrl ?? 'https://loja.example.com',
    apiPublicUrl: options.apiPublicUrl ?? 'https://api.example.com',
  });
  return { gateway, calls };
}

const checkoutRequest = {
  orderId: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301',
  items: [
    { name: 'Headset', unitPriceCents: 34990, quantity: 1 },
    { name: 'Caneca', unitPriceCents: 4900, quantity: 2 },
  ],
  totalCents: 44790,
  expiresAt,
};

describe('centsToReais', () => {
  it.each([
    [34990, 349.9],
    [1, 0.01],
    [29970, 299.7],
    [100, 1],
    [4900, 49],
    [59900, 599],
    [199, 1.99],
    [2147483647, 21474836.47],
  ])('%d centavos -> %d reais', (cents, reais) => {
    expect(centsToReais(cents)).toBe(reais);
  });
});

describe('MercadoPagoGateway.createCheckout', () => {
  it("name é 'mercadopago'", () => {
    expect(build().gateway.name).toBe('mercadopago');
  });

  it('envia a Preference exata com HTTPS: itens em reais, expires, back_urls, auto_return e notification_url', async () => {
    const { gateway, calls } = build();
    const result = await gateway.createCheckout(checkoutRequest);

    expect(result).toEqual({
      checkoutId: 'pref-1',
      checkoutUrl: 'https://mp.test/checkout/pref-1',
    });
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]!.body).toEqual({
      items: [
        { id: '1', title: 'Headset', quantity: 1, unit_price: 349.9, currency_id: 'BRL' },
        { id: '2', title: 'Caneca', quantity: 2, unit_price: 49, currency_id: 'BRL' },
      ],
      external_reference: checkoutRequest.orderId,
      back_urls: {
        success: `https://loja.example.com/pedido/${checkoutRequest.orderId}`,
        failure: `https://loja.example.com/pedido/${checkoutRequest.orderId}`,
        pending: `https://loja.example.com/pedido/${checkoutRequest.orderId}`,
      },
      auto_return: 'approved',
      notification_url: 'https://api.example.com/webhooks/mercadopago',
      expires: true,
      expiration_date_to: '2026-03-10T15:30:00.000Z',
    });
  });

  it('idempotencyKey = preference-<orderId>', async () => {
    const { gateway, calls } = build();
    await gateway.createCheckout(checkoutRequest);
    expect(calls.create[0]!.requestOptions).toEqual({
      idempotencyKey: `preference-${checkoutRequest.orderId}`,
    });
  });

  it('com URLs HTTP (dev local): sem auto_return e sem notification_url', async () => {
    const { gateway, calls } = build({
      webUrl: 'http://localhost:5173',
      apiPublicUrl: 'http://localhost:3333',
    });
    await gateway.createCheckout(checkoutRequest);
    const body = calls.create[0]!.body;
    expect(body).not.toHaveProperty('auto_return');
    expect(body).not.toHaveProperty('notification_url');
    expect(body).toMatchObject({
      expires: true,
      expiration_date_to: '2026-03-10T15:30:00.000Z',
      external_reference: checkoutRequest.orderId,
      back_urls: { success: `http://localhost:5173/pedido/${checkoutRequest.orderId}` },
    });
  });

  it('web HTTPS e API HTTP: só auto_return; web HTTP e API HTTPS: só notification_url', async () => {
    const a = build({ webUrl: 'https://loja.example.com', apiPublicUrl: 'http://localhost:3333' });
    await a.gateway.createCheckout(checkoutRequest);
    expect(a.calls.create[0]!.body).toHaveProperty('auto_return', 'approved');
    expect(a.calls.create[0]!.body).not.toHaveProperty('notification_url');

    const b = build({ webUrl: 'http://localhost:5173', apiPublicUrl: 'https://api.example.com' });
    await b.gateway.createCheckout(checkoutRequest);
    expect(b.calls.create[0]!.body).not.toHaveProperty('auto_return');
    expect(b.calls.create[0]!.body).toHaveProperty('notification_url');
  });

  it('remove a barra final das URLs base', async () => {
    const { gateway, calls } = build({
      webUrl: 'https://loja.example.com/',
      apiPublicUrl: 'https://api.example.com/',
    });
    await gateway.createCheckout(checkoutRequest);
    const body = calls.create[0]!.body as {
      notification_url: string;
      back_urls: { success: string };
    };
    expect(body.notification_url).toBe('https://api.example.com/webhooks/mercadopago');
    expect(body.back_urls.success).toBe(
      `https://loja.example.com/pedido/${checkoutRequest.orderId}`,
    );
  });

  it('erro do SDK vira GatewayError sem vazar o access token', async () => {
    const { gateway } = build({
      createResult: async () => {
        throw Object.assign(new Error(`invalid access token ${TOKEN}`), {
          status: 401,
          cause: [{ description: `Bearer ${TOKEN}` }],
        });
      },
    });
    const error = await gateway.createCheckout(checkoutRequest).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    const dump =
      JSON.stringify(error, Object.getOwnPropertyNames(error as object)) +
      String((error as Error).message) +
      String((error as Error).stack) +
      JSON.stringify((error as { cause?: unknown }).cause ?? null, ['message', 'name']);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain('super-secret');
  });

  it('resposta sem id ou init_point: GatewayError', async () => {
    const { gateway } = build({ createResult: async () => ({ id: 'x' }) });
    await expect(gateway.createCheckout(checkoutRequest)).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('MercadoPagoGateway.getPayment', () => {
  const approved = {
    id: 123456,
    status: 'approved',
    transaction_amount: 349.9,
    external_reference: 'order-1',
  };

  it('converte transaction_amount (reais) em centavos e lê o orderId de external_reference', async () => {
    const { gateway, calls } = build({ getResult: async () => approved });
    await expect(gateway.getPayment('123456')).resolves.toEqual({
      id: '123456',
      status: 'approved',
      orderId: 'order-1',
      amountCents: 34990,
    });
    expect(calls.get).toEqual([{ id: '123456' }]);
  });

  it.each([
    [0.01, 1],
    [299.7, 29970],
    [1.15, 115],
    [19.99, 1999],
    [0.29, 29],
  ])('R$ %d -> %d centavos (Math.round, sem erro de ponto flutuante)', async (reais, cents) => {
    const { gateway } = build({
      getResult: async () => ({ ...approved, transaction_amount: reais }),
    });
    expect((await gateway.getPayment('1')).amountCents).toBe(cents);
  });

  it.each([
    'approved',
    'pending',
    'in_process',
    'authorized',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
    'in_mediation',
  ])('aceita o status %s', async (status) => {
    const { gateway } = build({ getResult: async () => ({ ...approved, status }) });
    expect((await gateway.getPayment('1')).status).toBe(status);
  });

  it("status desconhecido vira 'unknown' (o service trata como sem mudança), não erro", async () => {
    const { gateway } = build({ getResult: async () => ({ ...approved, status: 'algo_novo' }) });
    const payment = await gateway.getPayment('1');
    expect(payment.status).toBe('unknown');
    expect(payment.rawStatus).toBe('algo_novo');
  });

  it('external_reference ou valor ausentes/inválidos: GatewayError', async () => {
    for (const bad of [
      { ...approved, external_reference: undefined },
      { ...approved, transaction_amount: undefined },
      { ...approved, transaction_amount: Number.NaN },
      { ...approved, transaction_amount: Number.POSITIVE_INFINITY },
      { ...approved, transaction_amount: 0 },
      { ...approved, transaction_amount: -5 },
    ]) {
      const { gateway } = build({ getResult: async () => bad });
      await expect(gateway.getPayment('1')).rejects.toBeInstanceOf(GatewayError);
    }
  });

  it('404 do provedor (pagamento inexistente): GatewayError com notFound = true', async () => {
    const { gateway } = build({
      getResult: async () => {
        throw Object.assign(new Error(`Payment not found ${TOKEN}`), { status: 404 });
      },
    });
    const error = await gateway.getPayment('123456').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).notFound).toBe(true);
    expect(String((error as Error).message) + String((error as Error).stack)).not.toContain(TOKEN);
  });

  it.each([400, 401, 429, 500, 503])(
    'HTTP %d do provedor NÃO é notFound (continua erro)',
    async (status) => {
      const { gateway } = build({
        getResult: async () => {
          throw Object.assign(new Error('falha'), { status });
        },
      });
      const error = await gateway.getPayment('1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).notFound).toBe(false);
    },
  );

  it('erro de rede sem status não é notFound', async () => {
    const { gateway } = build({
      getResult: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const error = await gateway.getPayment('1').catch((e: unknown) => e);
    expect((error as GatewayError).notFound).toBe(false);
  });

  it('erro do SDK vira GatewayError sem vazar o access token', async () => {
    const { gateway } = build({
      getResult: async () => {
        throw new Error(`Unauthorized: ${TOKEN}`);
      },
    });
    const error = await gateway.getPayment('1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(String((error as Error).message) + String((error as Error).stack)).not.toContain(TOKEN);
  });
});
