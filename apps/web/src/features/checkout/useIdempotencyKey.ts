import { useRef } from 'react';
import { newIdempotencyKey } from '../../lib/idempotency';

// Chave guardada em useRef: sobrevive a re-renders e só muda quando a assinatura (carrinho +
// dados do cliente) muda, ou quando alguém chama renew(). O retry depois de um erro reusa a
// MESMA chave (a API devolve o pedido já criado em vez de duplicar).
export function useIdempotencyKey() {
  const ref = useRef<{ signature: string; key: string } | null>(null);
  return {
    keyFor(signature: string): string {
      if (ref.current?.signature !== signature) {
        ref.current = { signature, key: newIdempotencyKey() };
      }
      return ref.current.key;
    },
    // Força chave nova na próxima tentativa (pedido concluído, expirado ou chave já usada).
    renew(): void {
      ref.current = null;
    },
  };
}
