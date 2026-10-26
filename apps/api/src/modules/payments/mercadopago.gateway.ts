import { MercadoPagoConfig, Payment as MpPayment, Preference } from 'mercadopago';
import {
  GatewayError,
  PAYMENT_STATUSES,
  type CheckoutRequest,
  type CheckoutResult,
  type Payment,
  type PaymentGateway,
  type PaymentStatus,
} from './payment-gateway.js';

// Subconjunto do SDK que usamos: permite injetar um cliente falso nos testes.
export interface MercadoPagoPreferenceClient {
  create(data: {
    body: Record<string, unknown>;
    requestOptions?: { idempotencyKey?: string };
  }): Promise<{ id?: string; init_point?: string }>;
}

export interface MercadoPagoPaymentClient {
  get(data: { id: string | number }): Promise<{
    id?: number | string;
    status?: string;
    transaction_amount?: number;
    external_reference?: string;
  }>;
}

export interface MercadoPagoGatewayDeps {
  accessToken: string;
  preference: MercadoPagoPreferenceClient;
  payment: MercadoPagoPaymentClient;
  webUrl: string;
  apiPublicUrl: string;
}

// Centavos inteiros -> reais com 2 casas (34990 -> 349.9). A divisão por 100 e o arredondamento
// para 2 casas dão exatamente o valor decimal; o Mercado Pago recebe reais.
export function centsToReais(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

const isHttps = (url: string): boolean => url.startsWith('https://');

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus);
}

export class MercadoPagoGateway implements PaymentGateway {
  readonly name = 'mercadopago';

  private readonly accessToken: string;
  private readonly preference: MercadoPagoPreferenceClient;
  private readonly payment: MercadoPagoPaymentClient;
  private readonly webUrl: string;
  private readonly apiPublicUrl: string;

  constructor(deps: MercadoPagoGatewayDeps) {
    this.accessToken = deps.accessToken;
    this.preference = deps.preference;
    this.payment = deps.payment;
    this.webUrl = deps.webUrl.replace(/\/+$/, '');
    this.apiPublicUrl = deps.apiPublicUrl.replace(/\/+$/, '');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const backUrl = `${this.webUrl}/pedido/${req.orderId}`;
    const body: Record<string, unknown> = {
      items: req.items.map((item, index) => ({
        id: String(index + 1),
        title: item.name,
        quantity: item.quantity,
        unit_price: centsToReais(item.unitPriceCents),
        currency_id: 'BRL',
      })),
      external_reference: req.orderId,
      back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
      expires: true,
      expiration_date_to: req.expiresAt.toISOString(),
    };
    // O Mercado Pago só aceita auto_return e notification_url com HTTPS.
    if (isHttps(this.webUrl)) body.auto_return = 'approved';
    if (isHttps(this.apiPublicUrl)) {
      body.notification_url = `${this.apiPublicUrl}/webhooks/mercadopago`;
    }

    let created: { id?: string; init_point?: string };
    try {
      created = await this.preference.create({
        body,
        requestOptions: { idempotencyKey: `preference-${req.orderId}` },
      });
    } catch (err) {
      throw this.wrap('Falha ao criar o checkout no Mercado Pago', err);
    }
    if (!created.id || !created.init_point) {
      throw new GatewayError('Resposta do Mercado Pago sem id ou init_point');
    }
    return { checkoutId: created.id, checkoutUrl: created.init_point };
  }

  async getPayment(paymentId: string): Promise<Payment> {
    let found: Awaited<ReturnType<MercadoPagoPaymentClient['get']>>;
    try {
      found = await this.payment.get({ id: paymentId });
    } catch (err) {
      throw this.wrap('Falha ao consultar o pagamento no Mercado Pago', err);
    }
    if (!isPaymentStatus(found.status)) {
      throw new GatewayError('Status de pagamento desconhecido no Mercado Pago');
    }
    if (!found.external_reference) {
      throw new GatewayError('Pagamento do Mercado Pago sem external_reference');
    }
    const amount = found.transaction_amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new GatewayError('Pagamento do Mercado Pago sem transaction_amount válido');
    }
    return {
      id: String(found.id ?? paymentId),
      status: found.status,
      orderId: found.external_reference,
      amountCents: Math.round(amount * 100),
    };
  }

  // Erros do SDK podem trazer o corpo/cabeçalhos da requisição: só a mensagem, sem o token.
  private wrap(message: string, err: unknown): GatewayError {
    const raw = err instanceof Error ? err.message : String(err);
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
        ? ` (HTTP ${err.status})`
        : '';
    const safe = raw.split(this.accessToken).join('[redacted]');
    return new GatewayError(`${message}${status}`, { cause: new Error(safe) });
  }
}

// Um Mercado Pago lento não pode segurar a requisição do cliente indefinidamente.
const MP_TIMEOUT_MS = 8_000;

export interface MercadoPagoFactoryOptions {
  accessToken: string;
  webUrl: string;
  apiPublicUrl: string;
}

export function createMercadoPagoGateway(options: MercadoPagoFactoryOptions): MercadoPagoGateway {
  const config = new MercadoPagoConfig({
    accessToken: options.accessToken,
    options: { timeout: MP_TIMEOUT_MS },
  });
  return new MercadoPagoGateway({
    accessToken: options.accessToken,
    preference: new Preference(config) as unknown as MercadoPagoPreferenceClient,
    payment: new MpPayment(config) as unknown as MercadoPagoPaymentClient,
    webUrl: options.webUrl,
    apiPublicUrl: options.apiPublicUrl,
  });
}
