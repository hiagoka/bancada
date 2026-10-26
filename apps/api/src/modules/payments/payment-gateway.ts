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

export interface CheckoutResult {
  checkoutId: string;
  checkoutUrl: string;
}

export interface Payment {
  id: string;
  // 'unknown' = status que o sistema não reconhece (tratado como sem mudança).
  status: PaymentStatus | 'unknown';
  // Status original do provedor quando não reconhecido (para auditoria em payment_events).
  rawStatus?: string;
  orderId: string;
  amountCents: number;
}

export interface PaymentGateway {
  readonly name: 'mercadopago' | 'fake';
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
