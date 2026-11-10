export type RedirectTarget = { kind: 'internal'; to: string } | { kind: 'external'; url: string };

// Decide para onde ir depois de criar o pedido. O checkoutUrl vem da API, mas só é seguido se for
// http(s) e sem credenciais embutidas: qualquer outra coisa (javascript:, data:, file:, lixo) cai
// em /pedido/:id. Mesma origem do web (modo fake) navega pelo router; origem diferente (checkout
// externo de um provedor) é redirecionamento externo. Sem checkoutUrl (Pix da AbacatePay, D34) vai para
// /pedido/:id, onde o QR Code e o copia e cola aparecem.
export function resolveRedirect(
  checkoutUrl: string | null | undefined,
  orderId: string,
  origin: string,
): RedirectTarget {
  const fallback: RedirectTarget = { kind: 'internal', to: `/pedido/${orderId}` };
  if (!checkoutUrl) return fallback;

  let url: URL;
  try {
    url = new URL(checkoutUrl, origin);
  } catch {
    return fallback;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
  if (url.username !== '' || url.password !== '') return fallback;

  // Página em https: o pagamento externo também precisa ser https (nada de rebaixar para http).
  if (url.protocol === 'http:' && origin.startsWith('https:')) return fallback;

  if (url.origin === origin)
    return { kind: 'internal', to: `${url.pathname}${url.search}${url.hash}` };
  return { kind: 'external', url: url.toString() };
}
