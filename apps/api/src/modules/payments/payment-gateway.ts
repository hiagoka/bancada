export type PaymentStatus =
  | 'approved'
  | 'pending'
  | 'in_process'
  | 'authorized'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'charged_back'
  | 'in_mediation';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'approved',
  'pending',
  'in_process',
  'authorized',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back',
  'in_mediation',
];

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
  status: PaymentStatus;
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
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GatewayError';
  }
}
