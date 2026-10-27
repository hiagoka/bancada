import { resolveRedirect, type RedirectTarget } from '../checkout/redirect';

// Destino do botão "Ir para o pagamento": a MESMA regra segura do checkout (só http(s), sem
// credenciais, https em página https; mesma origem vai pelo router). Sem URL usável, ou se ela
// só apontaria de volta para a própria página do pedido, devolve null.
export function paymentTarget(
  checkoutUrl: string | null | undefined,
  orderId: string,
  origin: string,
): RedirectTarget | null {
  if (!checkoutUrl) return null;
  const target = resolveRedirect(checkoutUrl, orderId, origin);
  if (target.kind === 'internal' && target.to === `/pedido/${orderId}`) return null;
  return target;
}

// A Preference do provedor expira 30 minutos depois da criação do pedido (D19). Passado esse tempo
// o botão de pagar não leva a lugar nenhum: a tela avisa. É SÓ texto: o status do pedido continua
// vindo da API (quem cancela é o admin ou o webhook).
export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

export function isPaymentWindowOpen(createdAt: string, now: number): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return true;
  return now - created < PAYMENT_WINDOW_MS;
}
