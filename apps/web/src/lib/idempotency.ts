// Chave do POST /orders. A T15 guarda a chave em useRef e só a troca quando o carrinho ou os
// dados do cliente mudam; o retry reusa a mesma (a API devolve o mesmo pedido).
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
