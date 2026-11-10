import { z } from 'zod';
import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutResult,
  type Payment,
  type PaymentGateway,
  type PaymentStatus,
} from './payment-gateway.js';

export const DEFAULT_ABACATEPAY_API_URL = 'https://api.abacatepay.com/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
// A AbacatePay recusa expiresIn menor que isso ("expiresIn must be at least 300 seconds").
export const MIN_EXPIRES_IN_SECONDS = 300;
// A AbacatePay soma expiresIn ao relógio DELA, que chega depois do nosso created_at (latência da
// chamada). Sem a margem o Pix poderia viver além de created_at + 30 min, e o admin já pode cancelar
// o pedido nesse instante (pagamento no intervalo = dinheiro recebido e pedido cancelado).
const SAFETY_MARGIN_SECONDS = 30;
const MAX_PROVIDER_MESSAGE = 200;
const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

export interface AbacatePayGatewayOptions {
  // Chave de API (abc_dev_... em modo teste, abc_prod_... em produção). O ambiente é definido por
  // ela, não pela URL. NUNCA entra em mensagem de erro nem em log.
  apiKey: string;
  apiUrl?: string;
  // Injetáveis para os testes (servidor HTTP falso e relógio).
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

// Faltam menos de 300 s até created_at + 30 min: a AbacatePay não aceitaria a cobrança, então a API
// nem é chamada. O OrdersService responde 502 CHECKOUT_UNAVAILABLE com details.reason = 'expired' (D19).
export class CheckoutExpiredError extends GatewayError {
  constructor() {
    super('Tempo restante insuficiente para criar a cobrança Pix (mínimo de 300 s)');
    this.name = 'CheckoutExpiredError';
  }
}

// Só o que usamos. Sem schema rígido: a AbacatePay pode acrescentar campos.
const createResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().min(1),
    brCode: z.string().min(1),
    // Vai para pix_qr_image e depois para um <img src> no web: só aceita imagem PNG embutida (data URI),
    // nunca uma URL arbitrária (rastreio) nem outro tipo de conteúdo.
    brCodeBase64: z.string().startsWith(PNG_DATA_URI_PREFIX),
    expiresAt: z.iso.datetime(),
  }),
});

const checkResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.string() }),
});

// Status da AbacatePay -> vocabulário comum de pagamento (seção 8.9). O que não muda o pedido vira
// 'unknown' (o status bruto fica em rawStatus e em payment_events). EXPIRED e CANCELLED não
// cancelam o pedido: a AbacatePay não envia webhook de expiração, e quem cancela é o admin (D14).
export function mapAbacatePayStatus(raw: string): PaymentStatus | 'unknown' {
  switch (raw) {
    case 'PAID':
      return 'approved';
    case 'REFUNDED':
      return 'refunded';
    case 'UNDER_DISPUTE':
      return 'in_mediation';
    case 'PENDING':
      return 'pending';
    default:
      return 'unknown';
  }
}

function describeProviderError(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'string' || error.trim() === '') return '';
  return `: ${error.trim().slice(0, MAX_PROVIDER_MESSAGE)}`;
}

const isNotFoundMessage = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { error?: unknown }).error === 'string' &&
  /not found/i.test((body as { error: string }).error);

export class AbacatePayGateway implements PaymentGateway {
  readonly name = 'abacatepay';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: AbacatePayGatewayOptions) {
    if (!options.apiKey) throw new Error('A chave de API da AbacatePay é obrigatória');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.apiUrl ?? DEFAULT_ABACATEPAY_API_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  // Cobrança Pix transparente (seção 8.9). Nenhum dado do cliente é enviado.
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const expiresIn =
      Math.floor((req.expiresAt.getTime() - this.now().getTime()) / 1000) - SAFETY_MARGIN_SECONDS;
    if (expiresIn < MIN_EXPIRES_IN_SECONDS) throw new CheckoutExpiredError();

    const body = await this.call('/transparents/create', {
      method: 'POST',
      body: {
        method: 'PIX',
        data: {
          amount: req.totalCents,
          expiresIn,
          externalId: req.orderId,
          description: `Pedido ${req.orderId.slice(0, 8).toUpperCase()}`,
          metadata: { orderId: req.orderId },
        },
      },
    });
    const parsed = createResponseSchema.safeParse(body.json);
    if (!parsed.success) {
      throw new GatewayError('AbacatePay devolveu uma cobrança Pix incompleta ou inesperada');
    }
    const { id, brCode, brCodeBase64, expiresAt } = parsed.data.data;
    return {
      checkoutId: id,
      checkoutUrl: null,
      pix: { brCode, qrCodeImage: brCodeBase64, expiresAt: new Date(expiresAt) },
    };
  }

  // Reconsulta o status da cobrança (GET /transparents/check). Não informa valor nem pedido: o
  // webhook acha o pedido por orders.checkout_id = id da cobrança.
  async getPayment(paymentId: string): Promise<Payment> {
    const body = await this.call(`/transparents/check?id=${encodeURIComponent(paymentId)}`, {
      method: 'GET',
    });
    const parsed = checkResponseSchema.safeParse(body.json);
    if (!parsed.success) {
      throw new GatewayError('AbacatePay devolveu um status de cobrança inesperado');
    }
    const rawStatus = parsed.data.data.status;
    return {
      id: paymentId,
      status: mapAbacatePayStatus(rawStatus),
      rawStatus,
      orderId: null,
      amountCents: null,
    };
  }

  // Chamada HTTP com timeout curto. Toda falha vira GatewayError com mensagem SEM credenciais (a
  // chave só existe no header Authorization), e o corpo completo nunca é copiado para a mensagem.
  private async call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<{ json: unknown }> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      // Sem `cause`: o erro de rede do fetch não deve ir parar em log por acidente.
      throw new GatewayError(
        timedOut
          ? 'Tempo esgotado ao falar com a AbacatePay'
          : 'Falha de rede ao falar com a AbacatePay',
      );
    }

    let json: unknown;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      throw new GatewayError(
        `AbacatePay respondeu HTTP ${response.status}${describeProviderError(json)}`,
        { notFound: response.status === 404 || isNotFoundMessage(json) },
      );
    }
    if (json === undefined)
      throw new GatewayError('AbacatePay devolveu uma resposta inválida (JSON)');
    if (
      typeof json === 'object' &&
      json !== null &&
      (json as { success?: unknown }).success === false
    ) {
      throw new GatewayError(`AbacatePay recusou a requisição${describeProviderError(json)}`, {
        notFound: isNotFoundMessage(json),
      });
    }
    return { json };
  }
}
