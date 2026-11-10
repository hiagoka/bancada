import { paymentStatusSchema, type PaymentStatus } from '@bancada/contracts';

// Fonte única: o schema do contracts (a API de simulação usa o mesmo).
export type { PaymentStatus };
export const PAYMENT_STATUSES: readonly PaymentStatus[] = paymentStatusSchema.options;

export interface CheckoutItem {
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CheckoutRequest {
  orderId: string;
  items: CheckoutItem[];
  totalCents: number;
  // Depois disso o provedor não aceita mais pagamento do pedido (D14).
  expiresAt: Date;
}

// Cobrança Pix que o cliente paga (AbacatePay, D34).
export interface PixInfo {
  // Pix copia e cola.
  brCode: string;
  // Imagem do QR Code (data URI PNG).
  qrCodeImage: string;
  expiresAt: Date;
}

export interface CheckoutResult {
  checkoutId: string;
  // Fake: página de checkout simulada. AbacatePay: null (o cliente paga pelo Pix).
  checkoutUrl: string | null;
  // AbacatePay: a cobrança Pix. Fake: null.
  pix: PixInfo | null;
}

export interface Payment {
  id: string;
  // 'unknown' = status que o sistema não reconhece (tratado como sem mudança).
  status: PaymentStatus | 'unknown';
  // Status original do provedor quando não reconhecido (para auditoria em payment_events).
  rawStatus?: string;
  // Id do NOSSO pedido, quando o provedor devolve (fake e simulate). null = o provedor não informa
  // (AbacatePay): o pedido é achado por orders.checkout_id = id do pagamento.
  orderId: string | null;
  // Valor pago, quando o provedor informa. null = não informa (AbacatePay): sem conferência de valor,
  // porque o Pix é fixado por nós ao criar a cobrança.
  amountCents: number | null;
}

export interface PaymentGateway {
  readonly name: 'abacatepay' | 'fake';
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  getPayment(paymentId: string): Promise<Payment>;
}

// Falha ao falar com o provedor de pagamento. A mensagem é segura para log (sem credenciais).
export class GatewayError extends Error {
  // true = o provedor respondeu 404 (o recurso não existe); qualquer outra falha é transitória.
  readonly notFound: boolean;

  constructor(message: string, options?: { cause?: unknown; notFound?: boolean }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GatewayError';
    this.notFound = options?.notFound ?? false;
  }
}
