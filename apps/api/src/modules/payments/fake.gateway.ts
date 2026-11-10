import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutResult,
  type Payment,
  type PaymentGateway,
} from './payment-gateway.js';

export interface FakePaymentGatewayOptions {
  webUrl: string;
  // Latência artificial em createCheckout (para provocar corridas nos testes).
  delayMs?: number;
}

// Pagamentos e checkouts em memória: roda e testa sem credenciais (D3).
export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'fake';

  // Instrumentação para os testes.
  createCheckoutCalls = 0;
  getPaymentCalls = 0;
  lastCheckoutRequest: CheckoutRequest | null = null;

  private readonly webUrl: string;
  private readonly delayMs: number;
  private readonly checkouts = new Map<string, CheckoutResult>();
  private readonly payments = new Map<string, Payment>();
  private pendingFailures = 0;
  private pendingGetPaymentFailures = 0;

  constructor({ webUrl, delayMs = 0 }: FakePaymentGatewayOptions) {
    this.webUrl = webUrl.replace(/\/+$/, '');
    this.delayMs = delayMs;
  }

  get checkoutCount(): number {
    return this.checkouts.size;
  }

  // As próximas n chamadas de createCheckout falham com GatewayError (indisponibilidade).
  failNextCheckout(n = 1): void {
    this.pendingFailures = n;
  }

  // As próximas n chamadas de getPayment falham como erro de rede/provedor (não notFound).
  failNextGetPayment(n = 1): void {
    this.pendingGetPaymentFailures = n;
  }

  // Idempotente por orderId, como a cobrança de um provedor real com chave de idempotência.
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    this.createCheckoutCalls += 1;
    this.lastCheckoutRequest = req;
    if (this.pendingFailures > 0) {
      this.pendingFailures -= 1;
      throw new GatewayError('Gateway fake indisponível');
    }
    // O checkout é registrado antes da espera: chamadas simultâneas enxergam o mesmo.
    let checkout = this.checkouts.get(req.orderId);
    if (!checkout) {
      checkout = {
        checkoutId: `fake-checkout-${req.orderId}`,
        checkoutUrl: `${this.webUrl}/checkout-simulado/${req.orderId}`,
      };
      this.checkouts.set(req.orderId, checkout);
    }
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return checkout;
  }

  // Alimenta getPayment (e, na T09, o /dev/payments/simulate).
  registerPayment(payment: Payment): void {
    this.payments.set(payment.id, payment);
  }

  async getPayment(paymentId: string): Promise<Payment> {
    this.getPaymentCalls += 1;
    if (this.pendingGetPaymentFailures > 0) {
      this.pendingGetPaymentFailures -= 1;
      throw new GatewayError('Gateway fake indisponível');
    }
    const payment = this.payments.get(paymentId);
    if (!payment)
      throw new GatewayError(`Pagamento ${paymentId} não encontrado no gateway fake`, {
        notFound: true,
      });
    return payment;
  }
}
