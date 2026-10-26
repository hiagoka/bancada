import { GatewayError } from '../src/modules/payments/payment-gateway.js';
import { FakePaymentGateway } from '../src/modules/payments/fake.gateway.js';

const webUrl = 'http://localhost:5173';
const request = (orderId: string) => ({
  orderId,
  items: [{ name: 'Mouse', unitPriceCents: 24900, quantity: 1 }],
  totalCents: 24900,
  expiresAt: new Date('2026-01-01T12:30:00.000Z'),
});

describe('FakePaymentGateway', () => {
  it("name é 'fake'", () => {
    expect(new FakePaymentGateway({ webUrl }).name).toBe('fake');
  });

  it('checkoutUrl = WEB_URL/checkout-simulado/:orderId e checkoutId determinístico', async () => {
    const gateway = new FakePaymentGateway({ webUrl: `${webUrl}/` });
    const checkout = await gateway.createCheckout(request('order-1'));
    expect(checkout.checkoutUrl).toBe(`${webUrl}/checkout-simulado/order-1`);
    expect(checkout.checkoutId).toBe('fake-checkout-order-1');
  });

  it('createCheckout é idempotente por orderId', async () => {
    const gateway = new FakePaymentGateway({ webUrl });
    const first = await gateway.createCheckout(request('o'));
    const second = await gateway.createCheckout(request('o'));
    expect(second).toEqual(first);
    expect(gateway.createCheckoutCalls).toBe(2);
    expect(gateway.checkoutCount).toBe(1);
  });

  it('guarda o último CheckoutRequest recebido', async () => {
    const gateway = new FakePaymentGateway({ webUrl });
    await gateway.createCheckout(request('o'));
    expect(gateway.lastCheckoutRequest).toEqual(request('o'));
  });

  it('failNextCheckout(n) falha n chamadas com GatewayError e depois volta ao normal', async () => {
    const gateway = new FakePaymentGateway({ webUrl });
    gateway.failNextCheckout(2);
    await expect(gateway.createCheckout(request('o'))).rejects.toBeInstanceOf(GatewayError);
    await expect(gateway.createCheckout(request('o'))).rejects.toBeInstanceOf(GatewayError);
    await expect(gateway.createCheckout(request('o'))).resolves.toBeDefined();
    expect(gateway.checkoutCount).toBe(1);
  });

  it('registerPayment alimenta getPayment; id desconhecido lança GatewayError', async () => {
    const gateway = new FakePaymentGateway({ webUrl });
    gateway.registerPayment({ id: '99', status: 'approved', orderId: 'o', amountCents: 24900 });
    await expect(gateway.getPayment('99')).resolves.toEqual({
      id: '99',
      status: 'approved',
      orderId: 'o',
      amountCents: 24900,
    });
    await expect(gateway.getPayment('nope')).rejects.toBeInstanceOf(GatewayError);
  });

  it('registerPayment de novo atualiza o status do mesmo pagamento', async () => {
    const gateway = new FakePaymentGateway({ webUrl });
    gateway.registerPayment({ id: '1', status: 'pending', orderId: 'o', amountCents: 100 });
    gateway.registerPayment({ id: '1', status: 'approved', orderId: 'o', amountCents: 100 });
    expect((await gateway.getPayment('1')).status).toBe('approved');
  });
});
